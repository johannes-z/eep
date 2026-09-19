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
  const filePath = join(directory, 'settings.json');
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
  expect(JSON.parse(await readFile(filePath, 'utf8'))).toEqual({
    version: 1,
    mqtt,
    transport,
    homeAssistant,
  });
});

test('rejects malformed or unsupported persisted settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-settings-invalid-'));
  const filePath = join(directory, 'settings.json');

  await Bun.write(filePath, JSON.stringify({ version: 2 }));
  expect(loadMqttSettings(filePath)).rejects.toThrow('Unsupported settings version: 2');

  await Bun.write(filePath, JSON.stringify({ mqtt: [] }));
  expect(loadMqttSettings(filePath)).rejects.toThrow('Invalid settings section: mqtt');
});
