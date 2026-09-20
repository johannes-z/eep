import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parse, stringify, type ScalarTag } from 'yaml';
import type { GeneralSettings, HomeAssistantSettings, TransportSettings } from './config';
import type { MqttSettings } from './mqtt';

export interface PersistedConfiguration {
  version?: 1;
  general?: { startId?: string | number };
  mqtt?: Record<string, unknown>;
  transport?: Partial<TransportSettings>;
  homeassistant?: Partial<HomeAssistantSettings>;
  devices?: Record<string, unknown>;
}

const writeQueues = new Map<string, Promise<void>>();

class SecretReference {
  constructor(readonly key: string) {}
}

const secretTag: ScalarTag = {
  tag: '!secret',
  identify: (value) => value instanceof SecretReference,
  resolve: (key) => new SecretReference(key),
  stringify: (node) => stringify((node.value as SecretReference).key).trimEnd(),
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function validateSection(data: Record<string, unknown>, key: string): void {
  if (data[key] !== undefined && !isRecord(data[key])) {
    throw new Error(`Invalid configuration section: ${key}`);
  }
}

function stringifyYaml(value: unknown): string {
  return stringify(value, { customTags: [secretTag], indent: 2 });
}

function parseDocument(text: string, filePath: string): PersistedConfiguration {
  const data: unknown = parse(text, { customTags: [secretTag] });
  if (!isRecord(data)) throw new Error(`Invalid configuration file: ${filePath}`);
  if (data.version !== undefined && data.version !== 1) {
    throw new Error(['Unsupported configuration version:', JSON.stringify(data.version)].join(' '));
  }
  validateSection(data, 'mqtt');
  validateSection(data, 'transport');
  validateSection(data, 'homeassistant');
  validateSection(data, 'general');
  if (data.devices !== undefined && !isRecord(data.devices)) {
    throw new Error('Invalid configuration section: devices');
  }
  return data as PersistedConfiguration;
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
  let secrets: Record<string, unknown> | undefined;
  let changed = false;
  for (const field of ['username', 'password'] as const) {
    const value = mqtt[field];
    if (value instanceof SecretReference) {
      const key = value.key;
      secrets ??= await readSecretFile(join(dirname(filePath), 'secrets.yaml'));
      if (!Object.prototype.hasOwnProperty.call(secrets, key)) {
        throw new Error(`Missing secret: ${key}`);
      }
      (resolvedMqtt as Record<string, unknown>)[field] = secrets[key];
      changed = true;
    }
  }

  if (!changed) return configuration;
  return {
    ...configuration,
    mqtt: resolvedMqtt,
  };
}

export async function loadConfiguration(filePath: string): Promise<PersistedConfiguration> {
  try {
    return resolveSecrets(parseDocument(await readFile(filePath, 'utf8'), filePath), filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    return {};
  }
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
    if (secrets[key] === value) return;
    secrets[key] = value;
    await writeFile(temporaryPath, stringifyYaml(secrets), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
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
    const data = { ...configuration, version: 1 } as PersistedConfiguration;
    const secretFilePath = join(dirname(filePath), 'secrets.yaml');
    for (const [field, key] of [
      ['username', 'mqtt_username'],
      ['password', 'mqtt_password'],
    ] as const) {
      if (typeof data.mqtt?.[field] === 'string' && data.mqtt[field]) {
        await writeSecretFile(secretFilePath, key, data.mqtt[field]);
        data.mqtt = { ...data.mqtt, [field]: new SecretReference(key) };
      }
    }
    await writeFile(temporaryPath, stringifyYaml(data), { encoding: 'utf8', mode: 0o600 });
    await rename(temporaryPath, filePath);
  } catch (error) {
    await Bun.file(temporaryPath)
      .delete()
      .catch(() => undefined);
    throw error;
  }
}

export async function updateConfiguration(
  filePath: string,
  update: (settings: PersistedConfiguration) => void,
): Promise<void> {
  const previous = writeQueues.get(filePath) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const settings = await loadConfiguration(filePath);
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

export async function saveMqttSettings(filePath: string, settings: MqttSettings): Promise<void> {
  await updateConfiguration(filePath, (stored) => {
    stored.mqtt = { ...settings };
  });
}

export async function saveTransportSettings(
  filePath: string,
  settings: TransportSettings,
): Promise<void> {
  await updateConfiguration(filePath, (stored) => {
    stored.transport = settings;
  });
}

export async function saveHomeAssistantSettings(
  filePath: string,
  settings: HomeAssistantSettings,
): Promise<void> {
  await updateConfiguration(filePath, (stored) => {
    stored.homeassistant = settings;
  });
}

export async function saveGeneralSettings(
  filePath: string,
  settings: GeneralSettings,
): Promise<void> {
  await updateConfiguration(filePath, (stored) => {
    stored.general = {
      ...stored.general,
      startId: settings.startId.toString(16).padStart(8, '0'),
    };
  });
}
