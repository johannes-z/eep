import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { deviceTransmitId, type Device, type DeviceTeachInInfo } from './types';
import {
  createDefaultProfileRegistry,
  normalizeProfileId,
  type ProfileRegistry,
} from '../profiles';
import type { JsonValue } from '../profiles/types';
import initialConfiguration from '../configuration.yaml';
import { loadConfiguration, updateConfiguration } from '../settings';
import { DeviceStateStore, type DeviceRuntimeState } from './stateStore';
import { parseEnOceanId } from '../util';

interface PersistedDevice {
  targetId: string | number;
  transmitId?: string | number | null;
  name: string;
  profileId: string;
  capabilities?: JsonValue;
  teachIn?: unknown;
}

export type DeviceChangeListener = (device: Device) => void;
export type DeviceRemoveListener = (device: Device) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (typeof value === 'number') return Number.isFinite(value);
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
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
    (channel !== undefined &&
      (typeof channel !== 'number' ||
        !Number.isInteger(channel) ||
        channel < 0 ||
        channel > 255)) ||
    (manufacturerId !== undefined &&
      (typeof manufacturerId !== 'number' ||
        !Number.isInteger(manufacturerId) ||
        manufacturerId < 0 ||
        manufacturerId > 0x7ff))
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
    ...(channel !== undefined ? { channel } : {}),
    ...(manufacturerId !== undefined ? { manufacturerId } : {}),
    direction: value.direction,
    responseExpected: value.responseExpected,
  };
}

function parseIdentifier(value: unknown, field: string): number {
  const parsed = parseEnOceanId(value);
  if (parsed === undefined) {
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
): Device {
  if (!isRecord(value)) throw new Error('Invalid device record');
  const sourceId = parseIdentifier(sourceIdValue, 'sourceId');
  const name =
    value.name === undefined
      ? `EnOcean ${sourceId.toString(16).padStart(8, '0')}`
      : readText(value.name, 'name');
  const profileId = normalizeProfileId(readText(value.profileId, 'profileId'));
  const profile = profiles.get(profileId);
  const fallbackCapabilities = profile?.defaultCapabilities() ?? [];
  const capabilities = profile
    ? profile.validateCapabilities(value.capabilities ?? fallbackCapabilities)
    : (() => {
        const opaque = value.capabilities ?? {};
        if (!isJsonValue(opaque)) throw new Error('Invalid capabilities');
        return opaque;
      })();
  return {
    sourceId,
    ...(profile?.receiveOnly || value.transmitId === null
      ? { transmitId: null }
      : value.transmitId === undefined
        ? {}
        : { transmitId: parseIdentifier(value.transmitId, 'transmitId') }),
    targetId: parseIdentifier(value.targetId, 'targetId'),
    name,
    profileId,
    capabilities,
    ...(value.teachIn === undefined ? {} : { teachIn: validateTeachInInfo(value.teachIn) }),
    availability: 'unknown',
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
  const transmitIds = new Set<number>();
  for (const device of devices) {
    if (sourceIds.has(device.sourceId)) throw new Error(`Duplicate sourceId: ${device.sourceId}`);
    sourceIds.add(device.sourceId);
    if (targetIds.has(device.targetId)) throw new Error(`Duplicate targetId: ${device.targetId}`);
    targetIds.add(device.targetId);
    const transmitId = deviceTransmitId(device);
    if (transmitId !== undefined) {
      if (transmitIds.has(transmitId)) throw new Error(`Duplicate transmitId: ${transmitId}`);
      transmitIds.add(transmitId);
    }
  }
  return devices;
}

function deserializeConfiguredDevices(values: unknown, profiles: ProfileRegistry): Device[] {
  if (!isRecord(values)) throw new Error('Invalid configuration: devices must be a map');
  return validateDevices(
    Object.entries(values).map(([sourceId, value]) => deserializeDevice(value, sourceId, profiles)),
  );
}

function serializeDevice(device: Device): PersistedDevice {
  return {
    name: device.name,
    profileId: device.profileId,
    targetId: device.targetId.toString(16).padStart(8, '0'),
    ...(device.transmitId === undefined
      ? {}
      : {
          transmitId:
            device.transmitId === null ? null : device.transmitId.toString(16).padStart(8, '0'),
        }),
    capabilities: device.capabilities,
    ...(device.teachIn === undefined ? {} : { teachIn: device.teachIn }),
  };
}

function serializeDevices(devices: Device[]): Record<string, PersistedDevice> {
  return Object.fromEntries(
    devices.map((device) => [
      device.sourceId.toString(16).padStart(8, '0'),
      serializeDevice(device),
    ]),
  );
}

const defaultProfiles = createDefaultProfileRegistry();

const initialDevices = deserializeConfiguredDevices(
  (initialConfiguration as { devices: unknown }).devices,
  defaultProfiles,
);

export class DeviceRegistry {
  private devices: Device[];
  private readonly listeners = new Set<DeviceChangeListener>();
  private readonly removeListeners = new Set<DeviceRemoveListener>();
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
    try {
      const configuration = await loadConfiguration(filePath);
      let devices: Device[] | undefined =
        configuration.devices === undefined
          ? undefined
          : deserializeConfiguredDevices(configuration.devices, profiles);
      if (devices === undefined) devices = initialDevices.map((device) => ({ ...device }));

      const runtimeStates = stateStore.load();
      const resetDevices: Device[] = [];
      const hydratedDevices = devices.map((device) => {
        const runtimeState = runtimeStates.get(device.sourceId);
        if (!runtimeState) return device;
        const profile = profiles.get(device.profileId);
        const validatedState = deserializeRuntimeState(
          { ...runtimeState },
          profile,
          device.capabilities,
        );
        const hydratedDevice = { ...device, ...validatedState };
        if (profile?.transientReportedState && hydratedDevice.reportedState !== undefined) {
          delete hydratedDevice.reportedState;
          resetDevices.push(hydratedDevice);
        }
        return hydratedDevice;
      });
      const registry = new DeviceRegistry(filePath, stateStore, hydratedDevices, profiles);
      await registry.save();
      for (const device of resetDevices) stateStore.save(device);
      return registry;
    } catch (error) {
      stateStore.close();
      throw error;
    }
  }

  list(): Device[] {
    return structuredClone(this.devices);
  }

  findByTargetId(targetId: number): Device | undefined {
    const device = this.devices.find((item) => item.targetId === targetId);
    return device ? structuredClone(device) : undefined;
  }

  findBySourceId(sourceId: number): Device | undefined {
    const device = this.devices.find((item) => item.sourceId === sourceId);
    return device ? structuredClone(device) : undefined;
  }

  findByTransmitId(transmitId: number): Device | undefined {
    const device = this.devices.find((item) => deviceTransmitId(item) === transmitId);
    return device ? structuredClone(device) : undefined;
  }

  onChange(listener: DeviceChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onRemove(listener: DeviceRemoveListener): () => void {
    this.removeListeners.add(listener);
    return () => this.removeListeners.delete(listener);
  }

  async close(): Promise<void> {
    await this.writeQueue;
    this.stateStore.close();
  }

  async upsert(device: Device): Promise<Device> {
    device = structuredClone(device);
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
    update = structuredClone(update);
    if (update.sourceId !== undefined && update.sourceId !== sourceId) {
      throw new Error('Use reassignSourceId to change a device source ID');
    }
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

  async reassignSourceId(
    sourceId: number,
    newSourceId: number,
    update: Partial<Device> = {},
  ): Promise<Device> {
    update = structuredClone(update);
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.sourceId === sourceId);
      if (index === -1) throw new Error(`Unknown device: ${sourceId}`);
      if (newSourceId !== sourceId && this.devices.some((item) => item.sourceId === newSourceId)) {
        throw new Error(`Source ID is already assigned: ${newSourceId}`);
      }
      const previous = { ...this.devices[index] };
      const next = { ...previous, ...update, sourceId: newSourceId };
      this.validateDevice(next);
      this.devices[index] = next;
      return {
        result: { ...next },
        changedDevice: { ...next },
        ...(newSourceId === sourceId ? {} : { removedSourceId: sourceId, removedDevice: previous }),
      };
    });
  }

  async remove(sourceId: number): Promise<boolean> {
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.sourceId === sourceId);
      if (index === -1) return { result: false };
      const removedDevice = { ...this.devices[index] };
      this.devices.splice(index, 1);
      return { result: true, removedSourceId: sourceId, removedDevice };
    });
  }

  private notify(device: Device): void {
    for (const listener of this.listeners) listener(structuredClone(device));
  }

  private validateDevice(device: Device): void {
    parseIdentifier(device.sourceId, 'sourceId');
    parseIdentifier(device.targetId, 'targetId');
    readText(device.name, 'name');
    readText(device.profileId, 'profileId');
    if (device.teachIn !== undefined) validateTeachInInfo(device.teachIn);
    const profile = this.profiles.get(device.profileId);
    if (profile?.receiveOnly) device.transmitId = null;
    if (device.transmitId !== undefined && device.transmitId !== null) {
      parseIdentifier(device.transmitId, 'transmitId');
    }
    const capabilities = profile?.validateCapabilities(device.capabilities) ?? device.capabilities;
    if (!isJsonValue(capabilities)) throw new Error('Invalid capabilities');
    deserializeRuntimeState({ ...device }, profile, capabilities);
  }

  private enqueueMutation<T>(
    mutation: () => {
      result: T;
      changedDevice?: Device;
      removedSourceId?: number;
      removedDevice?: Device;
    },
  ): Promise<T> {
    const next = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const previousDevices = this.devices;
        this.devices = previousDevices.map((device) => ({ ...device }));
        let change: ReturnType<typeof mutation>;
        let nextDevices: Device[];
        try {
          change = mutation();
          nextDevices = validateDevices(this.devices);
        } finally {
          this.devices = previousDevices;
        }
        const { result, changedDevice, removedSourceId, removedDevice } = change;
        if (!isDeepStrictEqual(serializeDevices(previousDevices), serializeDevices(nextDevices))) {
          await this.save(nextDevices);
        }
        if (removedSourceId !== undefined) this.stateStore.remove(removedSourceId);
        if (changedDevice) this.stateStore.save(changedDevice);
        this.devices = nextDevices;
        if (removedDevice) {
          for (const listener of this.removeListeners) listener(structuredClone(removedDevice));
        }
        if (changedDevice) {
          this.notify(changedDevice);
        }
        return structuredClone(result);
      });
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async save(devices: Device[] = this.devices): Promise<void> {
    await updateConfiguration(this.filePath, (configuration) => {
      configuration.devices = serializeDevices(devices);
    });
  }
}
