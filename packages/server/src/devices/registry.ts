import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Device, DeviceTeachInInfo } from '../config';
import {
  createDefaultProfileRegistry,
  normalizeProfileId,
  type ProfileRegistry,
} from '../profiles';
import type { JsonValue } from '../profiles/types';
import initialStates from '../states.json';

interface PersistedDevice extends Omit<Device, 'sourceId' | 'targetId'> {
  sourceId: string | number;
  targetId: string | number;
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

function deserializeDevice(value: unknown, profiles: ProfileRegistry): Device {
  if (!isRecord(value)) throw new Error('Invalid device record');
  const profileId = normalizeProfileId(readText(value.profileId ?? value.protocol, 'profileId'));
  const availability = value.availability;
  if (!['online', 'offline', 'unknown'].includes(availability as string)) {
    throw new Error(`Invalid availability: ${String(availability)}`);
  }
  if (typeof value.paired !== 'boolean') throw new Error('Invalid paired');
  if (value.lastSeen !== undefined && typeof value.lastSeen !== 'string') {
    throw new Error('Invalid lastSeen');
  }
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
  const validateState = (state: unknown, field: 'reportedState' | 'desiredState'): JsonValue => {
    const validated = profile?.validateState(state, field, capabilities) ?? state;
    if (!isJsonValue(validated)) throw new Error(`Invalid ${field}`);
    return validated;
  };
  return {
    key: readText(value.key, 'key'),
    sourceId: parseIdentifier(value.sourceId, 'sourceId'),
    targetId: parseIdentifier(value.targetId, 'targetId'),
    profileId,
    capabilities,
    roomId: readText(value.roomId, 'roomId'),
    roomName: readText(value.roomName, 'roomName'),
    name: readText(value.name, 'name'),
    paired: value.paired,
    ...(value.teachIn === undefined ? {} : { teachIn: validateTeachInInfo(value.teachIn) }),
    availability: profile ? (availability as Device['availability']) : 'unknown',
    ...(value.lastSeen === undefined ? {} : { lastSeen: value.lastSeen }),
    ...(value.reportedState === undefined
      ? {}
      : {
          reportedState: validateState(value.reportedState, 'reportedState'),
        }),
    ...(value.desiredState === undefined
      ? {}
      : {
          desiredState: validateState(value.desiredState, 'desiredState'),
        }),
  };
}

function deserializeDevices(values: unknown, profiles: ProfileRegistry): Device[] {
  if (!Array.isArray(values))
    throw new Error('Invalid device state file: devices must be an array');
  const devices = values.map((value) => deserializeDevice(value, profiles));
  const targetIds = new Set<number>();
  for (const device of devices) {
    if (targetIds.has(device.targetId)) throw new Error(`Duplicate targetId: ${device.targetId}`);
    targetIds.add(device.targetId);
  }
  return devices;
}

function serializeDevice(device: Device): PersistedDevice {
  return {
    ...device,
    sourceId: device.sourceId.toString(16).padStart(8, '0'),
    targetId: device.targetId.toString(16).padStart(8, '0'),
  };
}

const defaultProfiles = createDefaultProfileRegistry();

export const initialDevices = deserializeDevices(initialStates.devices, defaultProfiles);

async function readStates(
  filePath: string,
  profiles: ProfileRegistry,
): Promise<Device[] | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!isRecord(data) || !Array.isArray(data.devices)) {
      throw new Error(`Invalid device state file: ${filePath}`);
    }
    if (data.version !== undefined && data.version !== 1 && data.version !== 2) {
      throw new Error(`Unsupported device state version: ${JSON.stringify(data.version)}`);
    }
    return deserializeDevices(data.devices, profiles);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return undefined;
  }
}

export class DeviceRegistry {
  private devices: Device[];
  private readonly listeners = new Set<DeviceChangeListener>();
  private writeQueue: Promise<void> = Promise.resolve();

  private constructor(
    private readonly filePath: string,
    devices: Device[],
    private readonly profiles: ProfileRegistry,
  ) {
    this.devices = devices.map((device) => ({ ...device }));
  }

  static async load(
    filePath: string,
    profiles: ProfileRegistry = defaultProfiles,
  ): Promise<DeviceRegistry> {
    let devices = await readStates(filePath, profiles);
    if (devices === undefined && filePath.endsWith('states.json')) {
      devices = await readStates(join(dirname(filePath), 'devices.json'), profiles);
    }
    if (devices === undefined) devices = initialDevices.map((device) => ({ ...device }));

    const registry = new DeviceRegistry(filePath, devices, profiles);
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

  findByLocation(roomId: string, key: string): Device | undefined {
    const device = this.devices.find(
      (item) =>
        item.roomId.toUpperCase() === roomId.toUpperCase() &&
        item.key.toUpperCase() === key.toUpperCase(),
    );
    return device ? { ...device } : undefined;
  }

  onChange(listener: DeviceChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async upsert(device: Device): Promise<Device> {
    this.validateDevice(device);
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.targetId === device.targetId);
      if (index === -1) this.devices.push({ ...device });
      else this.devices[index] = { ...this.devices[index], ...device };
      const saved = { ...(this.devices[index === -1 ? this.devices.length - 1 : index] as Device) };
      return { result: saved, changedDevice: saved };
    });
  }

  async update(targetId: number, update: Partial<Device>): Promise<Device> {
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.targetId === targetId);
      if (index === -1) throw new Error(`Unknown device: ${targetId}`);
      const next = { ...this.devices[index], ...update };
      this.validateDevice(next);
      this.devices[index] = next;
      const saved = { ...next };
      return { result: saved, changedDevice: saved };
    });
  }

  async remove(targetId: number): Promise<boolean> {
    return this.enqueueMutation(() => {
      const index = this.devices.findIndex((item) => item.targetId === targetId);
      if (index === -1) return { result: false };
      this.devices.splice(index, 1);
      return { result: true };
    });
  }

  private notify(device: Device): void {
    for (const listener of this.listeners) listener({ ...device });
  }

  private validateDevice(device: Device): void {
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

  private enqueueMutation<T>(mutation: () => { result: T; changedDevice?: Device }): Promise<T> {
    const next = this.writeQueue
      .catch(() => undefined)
      .then(async () => {
        const { result, changedDevice } = mutation();
        await this.save();
        if (changedDevice) this.notify(changedDevice);
        return result;
      });
    this.writeQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async save(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    const temporaryPath = join(dirname(this.filePath), `.${randomUUID()}.states.json`);
    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify({ version: 2, devices: this.devices.map(serializeDevice) }, null, 2)}\n`,
        'utf8',
      );
      await rename(temporaryPath, this.filePath);
    } catch (error) {
      await Bun.file(temporaryPath)
        .delete()
        .catch(() => undefined);
      throw error;
    }
  }
}
