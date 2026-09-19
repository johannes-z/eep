import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HomeAssistantSettings, TransportSettings } from './config';
import type { MqttSettings } from './mqtt';

export interface PersistedSettings {
  version?: 1;
  mqtt?: Partial<MqttSettings>;
  transport?: Partial<TransportSettings>;
  homeAssistant?: Partial<HomeAssistantSettings>;
}

const writeQueues = new Map<string, Promise<void>>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateSection(data: Record<string, unknown>, key: string): void {
  if (data[key] !== undefined && !isRecord(data[key])) {
    throw new Error(`Invalid settings section: ${key}`);
  }
}

async function readSettings(filePath: string): Promise<PersistedSettings> {
  try {
    const data: unknown = JSON.parse(await readFile(filePath, 'utf8'));
    if (!isRecord(data)) throw new Error(`Invalid settings file: ${filePath}`);
    if (data.version !== undefined && data.version !== 1) {
      throw new Error(['Unsupported settings version:', JSON.stringify(data.version)].join(' '));
    }
    validateSection(data, 'mqtt');
    validateSection(data, 'transport');
    validateSection(data, 'homeAssistant');
    return data as PersistedSettings;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {};
  }
}

async function writeSettings(filePath: string, settings: PersistedSettings): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = join(dirname(filePath), `.${randomUUID()}.settings.json`);
  try {
    await writeFile(
      temporaryPath,
      `${JSON.stringify({ version: 1, ...settings }, null, 2)}\n`,
      'utf8',
    );
    await rename(temporaryPath, filePath);
  } catch (error) {
    await Bun.file(temporaryPath)
      .delete()
      .catch(() => undefined);
    throw error;
  }
}

async function updateSettings(
  filePath: string,
  update: (settings: PersistedSettings) => void,
): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const settings = await readSettings(filePath);
      update(settings);
      await writeSettings(filePath, settings);
    });
  const settled = next.catch(() => undefined);
  writeQueues.set(filePath, settled);
  void settled.then(() => {
    if (writeQueues.get(filePath) === settled) writeQueues.delete(filePath);
  });
  await next;
}

export async function loadMqttSettings(
  filePath: string,
): Promise<Partial<MqttSettings> | undefined> {
  const data = await readSettings(filePath);
  return data.mqtt && typeof data.mqtt === 'object' ? data.mqtt : undefined;
}

export async function saveMqttSettings(filePath: string, settings: MqttSettings): Promise<void> {
  await updateSettings(filePath, (stored) => {
    stored.mqtt = settings;
  });
}

export async function loadTransportSettings(
  filePath: string,
): Promise<Partial<TransportSettings> | undefined> {
  const data = await readSettings(filePath);
  return data.transport && typeof data.transport === 'object' ? data.transport : undefined;
}

export async function saveTransportSettings(
  filePath: string,
  settings: TransportSettings,
): Promise<void> {
  await updateSettings(filePath, (stored) => {
    stored.transport = settings;
  });
}

export async function loadHomeAssistantSettings(
  filePath: string,
): Promise<Partial<HomeAssistantSettings> | undefined> {
  const data = await readSettings(filePath);
  return data.homeAssistant && typeof data.homeAssistant === 'object'
    ? data.homeAssistant
    : undefined;
}

export async function saveHomeAssistantSettings(
  filePath: string,
  settings: HomeAssistantSettings,
): Promise<void> {
  await updateSettings(filePath, (stored) => {
    stored.homeAssistant = settings;
  });
}
