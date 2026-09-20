import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { GeneralSettings, HomeAssistantSettings, TransportSettings } from './config';
import type { MqttSettings } from './mqtt';
import { requireEnOceanId } from './util';

export interface PersistedConfiguration {
  version?: 1;
  general?: { startId?: string | number };
  mqtt?: Record<string, unknown>;
  transport?: Partial<TransportSettings>;
  homeassistant?: Partial<HomeAssistantSettings>;
  devices?: Record<string, unknown>;
}

const writeQueues = new Map<string, Promise<void>>();
const secretMarker = '__EEP_SECRET__';
const includeMarker = '__EEP_INCLUDE__';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseIdentifier(value: unknown, field: string): number {
  return requireEnOceanId(value, field, 1);
}

function validateSection(data: Record<string, unknown>, key: string): void {
  if (data[key] !== undefined && !isRecord(data[key])) {
    throw new Error(`Invalid configuration section: ${key}`);
  }
}

function normalizeYamlTags(text: string): string {
  return text
    .replace(/!secret\s+([A-Za-z0-9_.-]+)/g, `"${secretMarker}$1"`)
    .replace(/!include\s+([^\s#]+)/g, `"${includeMarker}$1"`);
}

function stringifyYaml(value: unknown): string {
  return Bun.YAML.stringify(value, null, 2).replace(/[ \t]+$/gm, '');
}

function parseDocument(text: string, filePath: string): PersistedConfiguration {
  const data: unknown = filePath.endsWith('.json')
    ? JSON.parse(text)
    : Bun.YAML.parse(normalizeYamlTags(text));
  if (!isRecord(data)) throw new Error(`Invalid configuration file: ${filePath}`);
  if (data.version !== undefined && data.version !== 1) {
    throw new Error(['Unsupported configuration version:', JSON.stringify(data.version)].join(' '));
  }
  validateSection(data, 'mqtt');
  validateSection(data, 'transport');
  validateSection(data, 'homeassistant');
  validateSection(data, 'general');
  validateSection(data, 'homeAssistant');
  if (data.devices !== undefined && !isRecord(data.devices)) {
    throw new Error('Invalid configuration section: devices');
  }
  return {
    ...data,
    homeassistant: data.homeassistant ?? data.homeAssistant,
  } as PersistedConfiguration;
}

async function readSecretFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const data: unknown = Bun.YAML.parse(await readFile(filePath, 'utf8'));
    if (!isRecord(data)) throw new Error(`Invalid secrets file: ${filePath}`);
    return data;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Missing secrets file: ${filePath}`);
    }
    throw error;
  }
}

async function resolveSecrets(
  configuration: PersistedConfiguration,
  filePath: string,
): Promise<PersistedConfiguration> {
  const mqtt = configuration.mqtt;
  if (!mqtt) return configuration;
  const resolvedMqtt = { ...mqtt };
  let changed = false;
  for (const field of ['username', 'password'] as const) {
    const value = mqtt[field];
    if (typeof value !== 'string') continue;
    if (value.startsWith(secretMarker)) {
      const key = value.slice(secretMarker.length);
      const secrets = await readSecretFile(join(dirname(filePath), 'secrets.yaml'));
      if (!Object.prototype.hasOwnProperty.call(secrets, key)) {
        throw new Error(`Missing secret: ${key}`);
      }
      (resolvedMqtt as Record<string, unknown>)[field] = secrets[key];
      changed = true;
    } else if (value.startsWith(includeMarker)) {
      const includedPath = join(dirname(filePath), value.slice(includeMarker.length));
      const included = Bun.YAML.parse(await readFile(includedPath, 'utf8'));
      if (typeof included !== 'string' || !included) {
        throw new Error(`Included secret must be a scalar: ${includedPath}`);
      }
      resolvedMqtt[field] = included;
      changed = true;
    }
  }

  if (!changed) return configuration;
  return {
    ...configuration,
    mqtt: resolvedMqtt,
  };
}

async function readConfiguration(filePath: string): Promise<PersistedConfiguration> {
  try {
    return resolveSecrets(parseDocument(await readFile(filePath, 'utf8'), filePath), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || filePath.endsWith('.json'))
      throw error;
    try {
      const legacyPath = join(dirname(filePath), 'settings.json');
      return resolveSecrets(
        parseDocument(await readFile(legacyPath, 'utf8'), legacyPath),
        legacyPath,
      );
    } catch (legacyError) {
      if ((legacyError as NodeJS.ErrnoException).code !== 'ENOENT') throw legacyError;
      return {};
    }
  }
}

async function replaceFile(temporaryPath: string, filePath: string): Promise<void> {
  try {
    await rename(temporaryPath, filePath);
    return;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== 'EACCES' && code !== 'EEXIST' && code !== 'EPERM') throw error;
  }
  await unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error;
  });
  await rename(temporaryPath, filePath);
}

async function writeSecretFile(filePath: string, key: string, value: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = join(dirname(filePath), `.${randomUUID()}.secrets.yaml`);
  try {
    let secrets: Record<string, unknown> = {};
    try {
      secrets = await readSecretFile(filePath);
    } catch (error) {
      if (!(error as Error).message.startsWith('Missing secrets file:')) throw error;
    }
    secrets[key] = value;
    await writeFile(temporaryPath, stringifyYaml(secrets), 'utf8');
    await replaceFile(temporaryPath, filePath);
  } catch (error) {
    await Bun.file(temporaryPath)
      .delete()
      .catch(() => undefined);
    throw error;
  }
}

async function writeConfiguration(
  filePath: string,
  configuration: PersistedConfiguration,
): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  const temporaryPath = join(dirname(filePath), `.${randomUUID()}.configuration.yaml`);
  try {
    const data = { ...configuration, version: 1 } as PersistedConfiguration & {
      homeAssistant?: unknown;
    };
    delete data.homeAssistant;
    const secretFilePath = join(dirname(filePath), 'secrets.yaml');
    let secrets: Record<string, unknown> | undefined;
    for (const [field, key] of [
      ['username', 'mqtt_username'],
      ['password', 'mqtt_password'],
    ] as const) {
      const value = data.mqtt?.[field];
      if (typeof value !== 'string' || !value) continue;
      if (!secrets) {
        try {
          secrets = await readSecretFile(secretFilePath);
        } catch (error) {
          if (!(error as Error).message.startsWith('Missing secrets file:')) throw error;
          secrets = {};
        }
      }
      if (secrets[key] !== value) {
        await writeSecretFile(secretFilePath, key, value);
        secrets[key] = value;
      }
      data.mqtt = { ...data.mqtt, [field]: `${secretMarker}${key}` };
    }
    let serialized = stringifyYaml(data);
    for (const key of ['mqtt_username', 'mqtt_password']) {
      serialized = serialized.replaceAll(`${secretMarker}${key}`, `!secret ${key}`);
    }
    await writeFile(temporaryPath, serialized, 'utf8');
    await replaceFile(temporaryPath, filePath);
  } catch (error) {
    await Bun.file(temporaryPath)
      .delete()
      .catch(() => undefined);
    throw error;
  }
}

async function updateSettings(
  filePath: string,
  update: (settings: PersistedConfiguration) => void,
): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const settings = await readConfiguration(filePath);
      update(settings);
      await writeConfiguration(filePath, settings);
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
  const data = await readConfiguration(filePath);
  return data.mqtt && typeof data.mqtt === 'object' ? data.mqtt : undefined;
}

export async function saveMqttSettings(filePath: string, settings: MqttSettings): Promise<void> {
  await updateSettings(filePath, (stored) => {
    stored.mqtt = { ...settings };
  });
}

export async function loadTransportSettings(
  filePath: string,
): Promise<Partial<TransportSettings> | undefined> {
  const data = await readConfiguration(filePath);
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
  const data = await readConfiguration(filePath);
  return data.homeassistant && typeof data.homeassistant === 'object'
    ? data.homeassistant
    : undefined;
}

export async function saveHomeAssistantSettings(
  filePath: string,
  settings: HomeAssistantSettings,
): Promise<void> {
  await updateSettings(filePath, (stored) => {
    stored.homeassistant = settings;
  });
}

export async function loadGeneralSettings(
  filePath: string,
): Promise<Partial<GeneralSettings> | undefined> {
  const data = await readConfiguration(filePath);
  const startId = data.general?.startId;
  return startId === undefined ? undefined : { startId: parseIdentifier(startId, 'startId') };
}

export async function saveGeneralSettings(
  filePath: string,
  settings: GeneralSettings,
): Promise<void> {
  await updateSettings(filePath, (stored) => {
    stored.general = {
      ...stored.general,
      startId: settings.startId.toString(16).padStart(8, '0'),
    };
  });
}

export async function loadConfiguration(filePath: string): Promise<PersistedConfiguration> {
  return readConfiguration(filePath);
}

export async function updateConfiguration(
  filePath: string,
  update: (configuration: PersistedConfiguration) => void,
): Promise<void> {
  await updateSettings(filePath, update);
}
