import { afterEach, expect, test } from 'bun:test';
import { getMqttSettings, resolveServerConfig } from './config';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

test('resolves standalone defaults without add-on configuration', () => {
  delete process.env.TRANSPORT_PATH;
  delete process.env.TRANSPORT_TYPE;
  delete process.env.START_ID;

  expect(resolveServerConfig()).toMatchObject({
    host: '127.0.0.1',
    port: 3000,
    transport: {
      type: 'none',
      path: '',
      baudRate: 57600,
      rtscts: false,
    },
    homeAssistant: {
      enabled: true,
      discoveryTopic: 'homeassistant',
      statusTopic: 'eep/status',
    },
  });
});

test('resolves a configured TCP transport', () => {
  expect(
    resolveServerConfig({
      transport: { type: 'tcp', path: 'tcp://127.0.0.1:20108' },
    }).transport,
  ).toMatchObject({
    type: 'tcp',
    path: 'tcp://127.0.0.1:20108',
  });
});

test('rejects invalid environment values', () => {
  process.env.PORT = 'not-a-port';
  expect(() => resolveServerConfig()).toThrow('PORT must be an integer');
});

test('resolves a configured start ID', () => {
  expect(resolveServerConfig({ startId: 0xffe76685 }).startId).toBe(0xffe76685);
});

test('rejects a zero start ID', () => {
  expect(() => resolveServerConfig({ startId: 0 })).toThrow(
    'startId must be an integer between 1 and 4294967295',
  );
});

test('rejects malformed persisted transport and Home Assistant values', () => {
  expect(() =>
    resolveServerConfig({
      transport: { path: 42 as never },
    }),
  ).toThrow('transport.path must be a string');
  expect(() =>
    resolveServerConfig({
      homeAssistant: { enabled: 'yes' as never },
    }),
  ).toThrow('homeAssistant.enabled must be a boolean');
});

test('rejects malformed MQTT environment values instead of silently changing their meaning', () => {
  process.env.MQTT_VERSION = 'invalid';
  expect(() => getMqttSettings({ mqtt: { url: 'mqtt://localhost' } })).toThrow('MQTT_VERSION');
  process.env.MQTT_VERSION = '4';
  process.env.MQTT_TLS = 'yes';
  expect(() => getMqttSettings({ mqtt: { url: 'mqtt://localhost' } })).toThrow('MQTT_TLS');
});

test('validates complete transport endpoints and publication topics at startup', () => {
  expect(() => resolveServerConfig({ transport: { type: 'tcp', path: 'tcp://host:0' } })).toThrow(
    'Invalid TCP',
  );
  expect(() =>
    resolveServerConfig({ homeAssistant: { discoveryTopic: 'homeassistant/#' } }),
  ).toThrow('without wildcards');
});
