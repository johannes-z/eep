import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HomeAssistantSettings, TransportSettings } from './config';
import { defaultMqttSettings } from './mqtt';
import {
  loadConfiguration,
  saveGeneralSettings,
  saveHomeAssistantSettings,
  saveMqttSettings,
  saveTransportSettings,
} from './settings';

const transport: TransportSettings = {
  type: 'serial',
  path: '/dev/ttyUSB0',
  baudRate: 115200,
  rtscts: true,
};

const homeAssistant: HomeAssistantSettings = {
  enabled: true,
  discoveryTopic: 'homeassistant',
  statusTopic: 'eep/status',
};

test('preserves settings sections across concurrent updates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-'));
  const filePath = join(directory, 'configuration.yaml');
  const mqtt = { ...defaultMqttSettings(), url: 'mqtt://broker.local:1883' };

  await Promise.all([
    saveMqttSettings(filePath, mqtt),
    saveTransportSettings(filePath, transport),
    saveHomeAssistantSettings(filePath, homeAssistant),
  ]);

  expect(await loadConfiguration(filePath)).toMatchObject({
    mqtt: { url: mqtt.url },
    transport: { path: transport.path },
    homeassistant: { statusTopic: homeAssistant.statusTopic },
  });
  const configuration = await readFile(filePath, 'utf8');
  expect(configuration).toMatch(/mqtt:\s*\n/);
  expect(configuration).not.toContain('mqtt: \n');
  expect(configuration).toContain('  url: mqtt://broker.local:1883');
  expect(Bun.YAML.parse(configuration)).toEqual({
    version: 1,
    mqtt,
    transport,
    homeassistant: homeAssistant,
  });
});

test('rejects malformed or unsupported persisted settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-invalid-'));
  const filePath = join(directory, 'configuration.yaml');

  await Bun.write(filePath, 'version: 2\n');
  expect(loadConfiguration(filePath)).rejects.toThrow('Unsupported configuration version: 2');

  await Bun.write(filePath, 'mqtt: []\n');
  expect(loadConfiguration(filePath)).rejects.toThrow('Invalid configuration section: mqtt');
});

test('persists the general start ID as a hexadecimal YAML value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-general-settings-'));
  const filePath = join(directory, 'configuration.yaml');

  await saveGeneralSettings(filePath, { startId: 0xffe76685 });

  expect((await loadConfiguration(filePath)).general).toEqual({ startId: 'ffe76685' });
  expect(Bun.YAML.parse(await readFile(filePath, 'utf8'))).toMatchObject({
    version: 1,
    general: { startId: 'ffe76685' },
  });
});

test('resolves secrets and keeps passwords out of configuration.yaml', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-secrets-'));
  const filePath = join(directory, 'configuration.yaml');
  const secretsPath = join(directory, 'secrets.yaml');
  await Bun.write(secretsPath, 'mqtt_username: test-user\nmqtt_password: test-password\n');
  await Bun.write(
    filePath,
    'version: 1\nmqtt:\n  url: mqtt://broker.local:1883\n  username: !secret mqtt_username\n  password: !secret mqtt_password\n',
  );

  expect((await loadConfiguration(filePath)).mqtt).toMatchObject({
    username: 'test-user',
    password: 'test-password',
  });

  await saveMqttSettings(filePath, {
    ...defaultMqttSettings(),
    url: 'mqtt://broker.local:1883',
    username: 'test-user',
    password: 'updated-password',
  });

  const configuration = await readFile(filePath, 'utf8');
  expect(configuration).toContain('username: !secret mqtt_username');
  expect(configuration).toContain('password: !secret mqtt_password');
  expect(configuration).not.toContain('__EEP_SECRET__');
  expect(configuration).not.toContain('test-user');
  expect(await readFile(secretsPath, 'utf8')).toContain('updated-password');
});

test('does not rewrite unchanged secrets when saving another setting', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-readonly-secrets-'));
  const filePath = join(directory, 'configuration.yaml');
  const secretsPath = join(directory, 'secrets.yaml');
  const secrets = '# managed externally\nmqtt_username: test-user\nmqtt_password: test-password\n';
  await Bun.write(secretsPath, secrets);
  await Bun.write(
    filePath,
    'version: 1\nmqtt:\n  username: !secret mqtt_username\n  password: !secret mqtt_password\n',
  );

  await saveTransportSettings(filePath, transport);

  expect(await readFile(secretsPath, 'utf8')).toBe(secrets);
});

test('resolves arbitrary YAML values from secret references', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-arbitrary-secret-'));
  const filePath = join(directory, 'configuration.yaml');
  await Bun.write(join(directory, 'secrets.yaml'), 'mqtt_username: false\n');
  await Bun.write(filePath, 'version: 1\nmqtt:\n  username: !secret mqtt_username\n');

  const configuration = await loadConfiguration(filePath);
  expect(configuration.mqtt?.username).toBe(false);
});

test('preserves literal secret-like text and parses quoted secret keys', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-literal-secret-'));
  const filePath = join(directory, 'configuration.yaml');
  await Bun.write(join(directory, 'secrets.yaml'), 'broker password: actual-password\n');
  await Bun.write(
    filePath,
    'mqtt:\n  username: "literal !secret username"\n  password: !secret "broker password"\n',
  );

  expect((await loadConfiguration(filePath)).mqtt).toMatchObject({
    username: 'literal !secret username',
    password: 'actual-password',
  });
  await saveTransportSettings(filePath, transport);
  expect((await loadConfiguration(filePath)).mqtt).toMatchObject({
    username: 'literal !secret username',
    password: 'actual-password',
  });
});
