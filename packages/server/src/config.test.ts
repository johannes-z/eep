import { afterEach, expect, test } from 'bun:test';
import { resolveServerConfig } from './config';

const originalEnvironment = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnvironment };
});

test('resolves standalone defaults without add-on configuration', () => {
  delete process.env.ADAPTER;
  delete process.env.ADAPTER_PATH;
  delete process.env.ADAPTER_TYPE;
  delete process.env.CONTROLLER_ID;

  expect(resolveServerConfig()).toMatchObject({
    host: '127.0.0.1',
    port: 3000,
    transport: {
      type: 'none',
      path: '',
      baudRate: 57600,
      disableLed: false,
      rtscts: false,
    },
    homeAssistant: {
      enabled: true,
      discoveryTopic: 'homeassistant',
      statusTopic: 'eep/status',
    },
  });
});

test('maps the legacy adapter input to a TCP transport', () => {
  expect(resolveServerConfig({ adapter: 'tcp://127.0.0.1:20108' }).transport).toMatchObject({
    type: 'tcp',
    path: 'tcp://127.0.0.1:20108',
  });
});

test('rejects invalid environment values', () => {
  process.env.PORT = 'not-a-port';
  expect(() => resolveServerConfig()).toThrow('PORT must be an integer');

  process.env.PORT = '3000';
  process.env.DISABLE_LED = 'sometimes';
  expect(() => resolveServerConfig()).toThrow('DISABLE_LED must be true or false');
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
