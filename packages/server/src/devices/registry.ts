import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  getDefaultSupportedFunctions,
  getProtocolFunctionByValue,
  getProtocolFunctions,
} from '../api/functions';
import { isD2ControlValue, normalizeD2FanPreset, type D2FanState } from '../api/D2-50-00/fan';
import type { Device } from '../config';
import initialStates from '../states.json';

interface PersistedDevice extends Omit<Device, 'sourceId' | 'targetId'> {
  sourceId: string | number;
  targetId: string | number;
}

export type DeviceChangeListener = (device: Device) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid ${field}`);
  return value.trim();
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

function parseSupportedFunctions(
  value: unknown,
  protocol: string,
  legacyPresets: unknown,
): string[] {
  const protocolFunctions = getProtocolFunctions(protocol);
  let functions = value;
  if (functions === undefined && legacyPresets !== undefined) {
    if (
      !Array.isArray(legacyPresets) ||
      legacyPresets.some((preset) => !normalizeD2FanPreset(preset))
    ) {
      throw new Error('Invalid supportedPresets');
    }
    functions = [
      ...getDefaultSupportedFunctions(protocol).filter(
        (id) => protocolFunctions[id]?.kind !== 'preset',
      ),
      ...Object.entries(protocolFunctions)
        .filter(
          ([, definition]) =>
            definition.kind === 'preset' &&
            legacyPresets.some((preset) => normalizeD2FanPreset(preset) === definition.preset),
        )
        .map(([id]) => id),
    ];
  }
  if (functions === undefined) functions = getDefaultSupportedFunctions(protocol);
  if (
    !Array.isArray(functions) ||
    functions.some((id) => typeof id !== 'string' || !protocolFunctions[id])
  ) {
    throw new Error('Invalid supportedFunctions');
  }
  if (new Set(functions).size !== functions.length) {
    throw new Error('Invalid supportedFunctions: duplicate function');
  }
  return [...functions];
}

function parseFanState(
  value: unknown,
  field: string,
  protocol: string,
  supportedFunctions: string[],
): D2FanState | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value)) throw new Error(`Invalid ${field}`);
  const { isOn, percentage, preset, d2Value } = value;
  if (typeof isOn !== 'boolean') throw new Error(`Invalid ${field}.isOn`);
  if (
    typeof percentage !== 'number' ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    throw new Error(`Invalid ${field}.percentage`);
  }
  if (
    typeof d2Value !== 'number' ||
    !Number.isInteger(d2Value) ||
    !isD2ControlValue(d2Value) ||
    d2Value === 15
  ) {
    throw new Error(`Invalid ${field}.d2Value`);
  }
  const normalizedPreset = normalizeD2FanPreset(preset);
  if (preset !== undefined && !normalizedPreset) {
    throw new Error(`Invalid ${field}.preset`);
  }
  const functionDefinition = getProtocolFunctionByValue(protocol, d2Value);
  if (!functionDefinition || !supportedFunctions.includes(functionDefinition.id)) {
    throw new Error(`Invalid ${field}.d2Value: unsupported by device`);
  }
  if (
    preset !== undefined &&
    (!functionDefinition.preset || functionDefinition.preset !== normalizedPreset)
  ) {
    throw new Error(`Invalid ${field}.preset: unsupported by device`);
  }
  return {
    isOn,
    percentage,
    d2Value,
    ...(normalizedPreset === undefined ? {} : { preset: normalizedPreset }),
  };
}

function deserializeDevice(value: unknown): Device {
  if (!isRecord(value)) throw new Error('Invalid device record');
  const protocol = readText(value.protocol, 'protocol');
  if (protocol !== 'D2-50-00') throw new Error(`Unsupported device protocol: ${protocol}`);
  const availability = value.availability;
  if (!['online', 'offline', 'unknown'].includes(availability as string)) {
    throw new Error(`Invalid availability: ${String(availability)}`);
  }
  if (typeof value.paired !== 'boolean') throw new Error('Invalid paired');
  if (value.lastSeen !== undefined && typeof value.lastSeen !== 'string') {
    throw new Error('Invalid lastSeen');
  }
  const supportedFunctions = parseSupportedFunctions(
    value.supportedFunctions,
    protocol,
    value.supportedPresets,
  );
  return {
    key: readText(value.key, 'key'),
    sourceId: parseIdentifier(value.sourceId, 'sourceId'),
    targetId: parseIdentifier(value.targetId, 'targetId'),
    protocol,
    roomId: readText(value.roomId, 'roomId'),
    roomName: readText(value.roomName, 'roomName'),
    name: readText(value.name, 'name'),
    paired: value.paired,
    supportedFunctions,
    availability: availability as Device['availability'],
    ...(value.lastSeen === undefined ? {} : { lastSeen: value.lastSeen }),
    ...(value.reportedState === undefined
      ? {}
      : {
          reportedState: parseFanState(
            value.reportedState,
            'reportedState',
            protocol,
            supportedFunctions,
          ),
        }),
    ...(value.desiredState === undefined
      ? {}
      : {
          desiredState: parseFanState(
            value.desiredState,
            'desiredState',
            protocol,
            supportedFunctions,
          ),
        }),
  };
}

function deserializeDevices(values: unknown): Device[] {
  if (!Array.isArray(values))
    throw new Error('Invalid device state file: devices must be an array');
  const devices = values.map(deserializeDevice);
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

export const initialDevices = deserializeDevices(initialStates.devices);

async function readStates(filePath: string): Promise<Device[] | undefined> {
  try {
    const data: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!isRecord(data) || !Array.isArray(data.devices)) {
      throw new Error(`Invalid device state file: ${filePath}`);
    }
    if (data.version !== undefined && data.version !== 1) {
      throw new Error(`Unsupported device state version: ${JSON.stringify(data.version)}`);
    }
    return deserializeDevices(data.devices);
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
  ) {
    this.devices = devices.map((device) => ({ ...device }));
  }

  static async load(filePath: string): Promise<DeviceRegistry> {
    let devices = await readStates(filePath);
    if (devices === undefined && filePath.endsWith('states.json')) {
      devices = await readStates(join(dirname(filePath), 'devices.json'));
    }
    if (devices === undefined) devices = initialDevices;

    const registry = new DeviceRegistry(filePath, devices);
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
      this.devices[index] = { ...this.devices[index], ...update };
      const saved = { ...this.devices[index] };
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
        `${JSON.stringify({ version: 1, devices: this.devices.map(serializeDevice) }, null, 2)}\n`,
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
