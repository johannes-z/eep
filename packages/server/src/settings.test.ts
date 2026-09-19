import { expect, test } from 'bun:test';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HomeAssistantSettings, TransportSettings } from './config';
import { defaultMqttSettings } from './mqtt';
import {
  loadHomeAssistantSettings,
  loadMqttSettings,
  loadTransportSettings,
  saveHomeAssistantSettings,
  saveMqttSettings,
  saveTransportSettings,
} from './settings';

const transport: TransportSettings = {
  type: 'serial',
  adapter: 'zstack',
  path: '/dev/ttyUSB0',
  baudRate: 115200,
  disableLed: false,
  rtscts: true,
};

const homeAssistant: HomeAssistantSettings = {
  enabled: true,
  discoveryTopic: 'homeassistant',
  statusTopic: 'eep/status',
  experimentalEventEntities: false,
  legacyActionSensor: false,
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

  expect(await loadMqttSettings(filePath)).toMatchObject({ url: mqtt.url });
  expect(await loadTransportSettings(filePath)).toMatchObject({ path: transport.path });
  expect(await loadHomeAssistantSettings(filePath)).toMatchObject({
    statusTopic: homeAssistant.statusTopic,
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
  expect(loadMqttSettings(filePath)).rejects.toThrow('Unsupported configuration version: 2');

  await Bun.write(filePath, 'mqtt: []\n');
  expect(loadMqttSettings(filePath)).rejects.toThrow('Invalid configuration section: mqtt');
});

test('resolves secrets and keeps passwords out of configuration.yaml', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-secrets-'));
  const filePath = join(directory, 'configuration.yaml');
  const secretsPath = join(directory, 'secrets.yaml');
  await Bun.write(secretsPath, 'mqtt_password: test-password\n');
  await Bun.write(
    filePath,
    'version: 1\nmqtt:\n  url: mqtt://broker.local:1883\n  password: !secret mqtt_password\n',
  );

  expect(await loadMqttSettings(filePath)).toMatchObject({ password: 'test-password' });

  await saveMqttSettings(filePath, {
    ...defaultMqttSettings(),
    url: 'mqtt://broker.local:1883',
    password: 'updated-password',
  });

  const configuration = await readFile(filePath, 'utf8');
  expect(configuration).toContain('password: !secret mqtt_password');
  expect(configuration).not.toContain('updated-password');
  expect(await readFile(secretsPath, 'utf8')).toContain('updated-password');
});
