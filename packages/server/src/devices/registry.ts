import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Device, DeviceTeachInInfo } from '../config';
import {
  createDefaultProfileRegistry,
  normalizeProfileId,
  type ProfileRegistry,
} from '../profiles';
import type { JsonValue } from '../profiles/types';
import initialConfiguration from '../configuration.yaml';
import { loadConfiguration, updateConfiguration } from '../settings';
import { DeviceStateStore, type DeviceRuntimeState } from './stateStore';

interface PersistedDevice {
  targetId: string | number;
  name: string;
  profileId?: string;
  protocol?: string;
  capabilities?: JsonValue;
  supportedFunctions?: unknown;
  paired?: boolean;
  teachIn?: unknown;
}

export type DeviceChangeListener = (device: Device) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'boolean' ||
    typeof value === 'number' ||
    typeof value === 'string'
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
}

function validateTeachInInfo(value: unknown): DeviceTeachInInfo {
  if (!isRecord(value)) throw new Error('Invalid teachIn');
  const channel = value.channel;
  const manufacturerId = value.manufacturerId;
  if (
    typeof channel !== 'number' ||
    !Number.isInteger(channel) ||
    channel < 0 ||
    channel > 255 ||
    typeof manufacturerId !== 'number' ||
    !Number.isInteger(manufacturerId) ||
    manufacturerId < 0 ||
    manufacturerId > 0x7ff
  ) {
    throw new Error('Invalid teachIn channel or manufacturerId');
  }
  if (value.direction !== 'unidirectional' && value.direction !== 'bidirectional') {
    throw new Error('Invalid teachIn direction');
  }
  if (typeof value.responseExpected !== 'boolean') {
    throw new Error('Invalid teachIn responseExpected');
  }
  return {
    eep: readText(value.eep, 'teachIn.eep').toUpperCase(),
    channel,
    manufacturerId,
    direction: value.direction,
    responseExpected: value.responseExpected,
  };
}

function parseIdentifier(value: unknown, field: string): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^(?:0x)?[0-9a-f]{1,8}$/i.test(value.trim())
        ? Number.parseInt(value.trim().replace(/^0x/i, ''), 16)
        : Number.NaN;
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 0xffffffff) {
    const displayValue =
      typeof value === 'string' || typeof value === 'number'
        ? String(value)
        : JSON.stringify(value);
    throw new Error(`Invalid ${field}: ${displayValue ?? 'unknown'}`);
  }
  return parsed;
}

function deserializeDevice(
  value: unknown,
  sourceIdValue: unknown,
  profiles: ProfileRegistry,
  includeRuntimeState = false,
): Device {
  if (!isRecord(value)) throw new Error('Invalid device record');
  const sourceId = parseIdentifier(sourceIdValue ?? value.sourceId, 'sourceId');
  const name =
    value.name === undefined && value.friendlyName === undefined
      ? `EnOcean ${sourceId.toString(16).padStart(8, '0')}`
      : readText(value.name ?? value.friendlyName, 'name');
  const profileId = normalizeProfileId(readText(value.profileId ?? value.protocol, 'profileId'));
  const paired = value.paired ?? true;
  if (typeof paired !== 'boolean') throw new Error('Invalid paired');
  if (!paired) throw new Error('Unpaired devices must not be persisted');
  const profile = profiles.get(profileId);
  const legacyCapabilities = value.supportedFunctions;
  if (
    legacyCapabilities !== undefined &&
    (!Array.isArray(legacyCapabilities) ||
      legacyCapabilities.some((item) => typeof item !== 'string') ||
      new Set(legacyCapabilities).size !== legacyCapabilities.length)
  ) {
    throw new Error('Invalid supportedFunctions');
  }
  const fallbackCapabilities = profile?.defaultCapabilities() ?? [];
  const capabilities = profile
    ? profile.validateCapabilities(value.capabilities ?? legacyCapabilities ?? fallbackCapabilities)
    : (() => {
        const opaque = value.capabilities ?? legacyCapabilities ?? {};
        if (!isJsonValue(opaque)) throw new Error('Invalid capabilities');
        return opaque;
      })();
  const runtimeState: DeviceRuntimeState = includeRuntimeState
    ? deserializeRuntimeState(value, profile, capabilities)
    : { availability: 'unknown' };
  return {
    sourceId,
    targetId: parseIdentifier(value.targetId, 'targetId'),
    name,
    profileId,
    capabilities,
    paired,
    ...(value.teachIn === undefined ? {} : { teachIn: validateTeachInInfo(value.teachIn) }),
    ...runtimeState,
  };
}

function deserializeRuntimeState(
  value: Record<string, unknown>,
  profile: ReturnType<ProfileRegistry['get']>,
  capabilities: JsonValue,
): DeviceRuntimeState {
  const availability = value.availability ?? 'unknown';
  if (availability !== 'online' && availability !== 'offline' && availability !== 'unknown') {
    throw new Error('Invalid availability');
  }
  if (value.lastSeen !== undefined && typeof value.lastSeen !== 'string') {
    throw new Error('Invalid lastSeen');
  }
  const validateState = (state: unknown, field: 'reportedState' | 'desiredState'): JsonValue => {
    const validated = profile?.validateState(state, field, capabilities) ?? state;
    if (!isJsonValue(validated)) throw new Error(`Invalid ${field}`);
    return validated;
  };
  return {
    availability,
    ...(value.lastSeen === undefined ? {} : { lastSeen: value.lastSeen }),
    ...(value.reportedState === undefined
      ? {}
      : { reportedState: validateState(value.reportedState, 'reportedState') }),
    ...(value.desiredState === undefined
      ? {}
      : { desiredState: validateState(value.desiredState, 'desiredState') }),
  };
}

function validateDevices(devices: Device[]): Device[] {
  const sourceIds = new Set<number>();
  const targetIds = new Set<number>();
  for (const device of devices) {
    if (sourceIds.has(device.sourceId)) throw new Error(`Duplicate sourceId: ${device.sourceId}`);
    sourceIds.add(device.sourceId);
    if (targetIds.has(device.targetId)) throw new Error(`Duplicate targetId: ${device.targetId}`);
    targetIds.add(device.targetId);
  }
  return devices;
}

function deserializeConfiguredDevices(values: unknown, profiles: ProfileRegistry): Device[] {
  if (!isRecord(values)) throw new Error('Invalid configuration: devices must be a map');
  return validateDevices(
    Object.entries(values).map(([sourceId, value]) => deserializeDevice(value, sourceId, profiles)),
  );
}

function deserializeLegacyDevices(
  values: unknown,
  profiles: ProfileRegistry,
  includeRuntimeState: boolean,
): Device[] {
  if (!Array.isArray(values))
    throw new Error('Invalid device state file: devices must be an array');
  const devices = values.map((value) =>
    deserializeDevice(value, undefined, profiles, includeRuntimeState),
  );
  return includeRuntimeState ? devices : validateDevices(devices);
}

function serializeDevice(device: Device): PersistedDevice {
  return {
    name: device.name,
    profileId: device.profileId,
    targetId: device.targetId.toString(16).padStart(8, '0'),
    capabilities: device.capabilities,
    ...(device.teachIn === undefined ? {} : { teachIn: device.teachIn }),
  };
}

const defaultProfiles = createDefaultProfileRegistry();

export const initialDevices = deserializeConfiguredDevices(
  (initialConfiguration as { devices: unknown }).devices,
  defaultProfiles,
);

async function readLegacyDevices(
  filePath: string,
  profiles: ProfileRegistry,
  includeRuntimeState: boolean,
): Promise<Device[] | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!isRecord(data) || !Array.isArray(data.devices)) {
      throw new Error(`Invalid device state file: ${filePath}`);
    }
    return deserializeLegacyDevices(data.devices, profiles, includeRuntimeState);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

function runtimeStateOf(device: Device): DeviceRuntimeState {
  return {
    availability: device.availability,
    ...(device.lastSeen === undefined ? {} : { lastSeen: device.lastSeen }),
    ...(device.reportedState === undefined ? {} : { reportedState: device.reportedState }),
    ...(device.desiredState === undefined ? {} : { desiredState: device.desiredState }),
  };
}

function mergeLegacyDevices(configured: Device[], runtime: Device[]): Device[] {
  const runtimeBySource = new Map(runtime.map((device) => [device.sourceId, device]));
  const configuredSources = new Set(configured.map((device) => device.sourceId));
  const devices = configured.map((device) => {
    const state = runtimeBySource.get(device.sourceId);
    return state ? { ...device, ...runtimeStateOf(state) } : device;
  });
  for (const device of runtimeBySource.values()) {
    if (!configuredSources.has(device.sourceId)) devices.push(device);
  }
  return validateDevices(devices);
}

export class DeviceRegistry {
  private devices: Device[];
  private readonly listeners = new Set<DeviceChangeListener>();
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    private readonly stateStore: DeviceStateStore,
    devices: Device[],
    private readonly profiles: ProfileRegistry,
  ) {
    this.devices = devices.map((device) => ({ ...device }));
  }

  static async load(
    filePath: string,
    profiles: ProfileRegistry = defaultProfiles,
  ): Promise<DeviceRegistry> {
    await mkdir(dirname(filePath), { recursive: true });
    const stateStore = DeviceStateStore.open(join(dirname(filePath), 'state.db'));
    const configuration = await loadConfiguration(filePath);
    let devices: Device[] | undefined =
      configuration.devices === undefined
        ? undefined
        : deserializeConfiguredDevices(configuration.devices, profiles);
    let legacyRuntimeDevices: Device[] | undefined;
    if (devices === undefined) {
      const legacyConfiguration = await readLegacyDevices(
        join(dirname(filePath), 'devices.json'),
        profiles,
        false,
      );
      legacyRuntimeDevices = await readLegacyDevices(
        join(dirname(filePath), 'states.json'),
        profiles,
        true,
      );
      if (legacyConfiguration || legacyRuntimeDevices) {
        devices = mergeLegacyDevices(legacyConfiguration ?? [], legacyRuntimeDevices ?? []);
      }
    }
    if (devices === undefined) devices = initialDevices.map((device) => ({ ...device }));

    const runtimeStates = stateStore.load();
    const hydratedDevices = devices.map((device) => ({
      ...device,
      ...(runtimeStates.get(device.sourceId) ?? {}),
    }));
    const registry = new DeviceRegistry(filePath, stateStore, hydratedDevices, profiles);
    if (legacyRuntimeDevices) {
      for (const device of legacyRuntimeDevices) {
        if (!runtimeStates.has(device.sourceId)) stateStore.save(device);
      }
    }
    await registry.save();
    return registry;
  }

  list(): Device[] {
    return this.devices.map((device) => ({ ...device }));
  }

  findByTargetId(targetId: number): Device | undefined {
    const device = this.devices.find((item) => item.targetId === targetId);
    return device ? { ...device } : undefined;
  }

  findBySourceId(sourceId: number): Device | undefined {
    const device = this.devices.find((item) => item.sourceId === sourceId);
    return device ? { ...device } : undefined;
  }

  onChange(listener: DeviceChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async upsert(device: Device): Promise<Device> {
    this.validateDevice(device);
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.sourceId === device.sourceId);
      if (index === -1) this.devices.push({ ...device });
      else this.devices[index] = { ...this.devices[index], ...device };
      const saved = { ...(this.devices[index === -1 ? this.devices.length - 1 : index] as Device) };
      return { result: saved, changedDevice: saved };
    });
  }

  async update(sourceId: number, update: Partial<Device>): Promise<Device> {
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.sourceId === sourceId);
      if (index === -1) throw new Error(`Unknown device: ${sourceId}`);
      const next = { ...this.devices[index], ...update };
      this.validateDevice(next);
      this.devices[index] = next;
      const saved = { ...next };
      return { result: saved, changedDevice: saved };
    });
  }

  async remove(sourceId: number): Promise<boolean> {
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.sourceId === sourceId);
      if (index === -1) return { result: false };
      this.devices.splice(index, 1);
      return { result: true, removedSourceId: sourceId };
    });
  }

  private notify(device: Device): void {
    for (const listener of this.listeners) listener({ ...device });
  }

  private validateDevice(device: Device): void {
    parseIdentifier(device.sourceId, 'sourceId');
    parseIdentifier(device.targetId, 'targetId');
    if (device.paired !== true) throw new Error('Invalid paired');
    if (device.teachIn !== undefined) validateTeachInInfo(device.teachIn);
    const profile = this.profiles.get(device.profileId);
    if (!profile) {
      if (!isJsonValue(device.capabilities)) throw new Error('Invalid capabilities');
      if (device.reportedState !== undefined && !isJsonValue(device.reportedState)) {
        throw new Error('Invalid reportedState');
      }
      if (device.desiredState !== undefined && !isJsonValue(device.desiredState)) {
        throw new Error('Invalid desiredState');
      }
      return;
    }
    const capabilities = profile.validateCapabilities(device.capabilities);
    if (!isJsonValue(capabilities)) throw new Error('Invalid capabilities');
    if (device.reportedState !== undefined) {
      const reportedState = profile.validateState(
        device.reportedState,
        'reportedState',
        capabilities,
      );
      if (!isJsonValue(reportedState)) throw new Error('Invalid reportedState');
    }
    if (device.desiredState !== undefined) {
      const desiredState = profile.validateState(device.desiredState, 'desiredState', capabilities);
      if (!isJsonValue(desiredState)) throw new Error('Invalid desiredState');
    }
  }

  private enqueueMutation<T>(
    mutation: () => { result: T; changedDevice?: Device; removedSourceId?: number },
  ): Promise<T> {
    const next = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const { result, changedDevice, removedSourceId } = mutation();
        await this.save();
        if (removedSourceId !== undefined) this.stateStore.remove(removedSourceId);
        if (changedDevice) {
          this.stateStore.save(changedDevice);
          this.notify(changedDevice);
        }
        return result;
      });
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async save(): Promise<void> {
    await updateConfiguration(this.filePath, (configuration) => {
      configuration.devices = Object.fromEntries(
        this.devices
          .filter((device) => device.paired)
          .map((device) => [
            device.sourceId.toString(16).padStart(8, '0'),
            serializeDevice(device),
          ]),
      );
    });
  }
}
