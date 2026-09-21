import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { connect } from 'mqtt';
import { MqttRuntime, type MqttRuntimeStatus } from './client';
import type { HomeAssistantSettings } from '../../config';
import type { DeviceRegistry } from '../../devices/registry';
import { defaultMqttSettings } from '../../mqtt';

type MqttConnector = typeof connect;
type Listener = (...args: never[]) => void;

class FakeMqttClient {
  endCallback?: (error?: Error) => void;
  endCalls = 0;
  private readonly listeners = new Map<string, Listener[]>();

  on(event: string, listener: Listener): this;
  on(event: string, listener: Listener): this {
    const listeners = this.listeners.get(event) ?? [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  publish(
    _topic: string,
    _payload: string,
    _options: { qos: 1; retain: boolean },
    callback?: (error?: Error) => void,
  ): void {
    callback?.();
  }

  subscribe(_topic: string, _options: { qos: 1 }, callback?: (error?: Error) => void): void {
    callback?.();
  }

  end(_force: boolean, callback?: (error?: Error) => void): this {
    this.endCalls += 1;
    this.endCallback = callback;
    return this;
  }

  emit(event: string, ...args: unknown[]): void {
    for (const listener of this.listeners.get(event) ?? []) {
      (listener as (...values: unknown[]) => void)(...args);
    }
  }
}

const homeAssistant: HomeAssistantSettings = {
  enabled: true,
  discoveryTopic: 'homeassistant',
  statusTopic: 'eep/status',
};

const registry = {
  list: () => [],
  onChange: () => () => undefined,
  onRemove: () => () => undefined,
} as unknown as DeviceRegistry;

test('waits for MQTT client shutdown and ignores stale events', async () => {
  const firstClient = new FakeMqttClient();
  const secondClient = new FakeMqttClient();
  const clients = [firstClient, secondClient];
  const status: MqttRuntimeStatus = { connected: false };
  const runtime = new MqttRuntime(
    registry,
    async () => undefined,
    status,
    undefined,
    undefined,
    (() => clients.shift() as FakeMqttClient) as unknown as MqttConnector,
  );
  const settings = { ...defaultMqttSettings(), url: 'mqtt://localhost:1883' };
  const notifications: MqttRuntimeStatus[] = [];
  const unsubscribe = runtime.onStatusChange(() => notifications.push({ ...status }));

  await runtime.apply(settings, homeAssistant);
  firstClient.emit('connect');
  expect(status.connected).toBe(true);
  expect(notifications.at(-1)).toEqual({ connected: true });

  firstClient.emit('error', new Error('connection lost'));
  expect(notifications.at(-1)).toEqual({ connected: false, error: 'connection lost' });
  firstClient.emit('connect');
  firstClient.emit('close');
  expect(notifications.at(-1)).toEqual({ connected: false });
  firstClient.emit('connect');

  const replacement = runtime.apply(settings, homeAssistant);
  await new Promise((resolve) => setTimeout(resolve, 0));
  const notificationCount = notifications.length;
  firstClient.emit('error', new Error('stale failure'));
  firstClient.emit('close');
  expect(notifications).toHaveLength(notificationCount);
  expect(status.error).toBeUndefined();
  firstClient.endCallback?.();
  await replacement;

  secondClient.emit('connect');
  expect(status).toEqual({ connected: true });

  const stopping = runtime.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(secondClient.endCalls).toBe(1);
  expect(status.connected).toBe(true);
  secondClient.endCallback?.();
  await stopping;
  expect(status.connected).toBe(false);
  expect(notifications.at(-1)).toEqual({ connected: false });
  unsubscribe();
  const finalCount = notifications.length;
  await runtime.stop();
  expect(notifications).toHaveLength(finalCount);
});

test('can stop a disconnected client without waiting for publish acknowledgements', async () => {
  const client = Object.assign(new FakeMqttClient(), { connected: false });
  client.publish = () => {
    throw new Error('Disconnected clients cannot acknowledge publications');
  };
  const runtime = new MqttRuntime(
    registry,
    async () => undefined,
    { connected: false },
    undefined,
    undefined,
    (() => client) as unknown as MqttConnector,
  );
  await runtime.apply({ ...defaultMqttSettings(), url: 'mqtt://localhost:1883' }, homeAssistant);
  const stopping = runtime.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(client.endCalls).toBe(1);
  client.endCallback?.();
  await stopping;
});

test('loads TLS files, preserves inline PEM, and rejects missing files before replacing a client', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-tls-'));
  const caPath = join(directory, 'ca.crt');
  const ca = '-----BEGIN CERTIFICATE-----\nCA\n-----END CERTIFICATE-----';
  const cert = '-----BEGIN CERTIFICATE-----\nCLIENT\n-----END CERTIFICATE-----';
  const key = '-----BEGIN PRIVATE KEY-----\nKEY\n-----END PRIVATE KEY-----';
  await Bun.write(caPath, ca);
  let options: Parameters<MqttConnector>[1];
  const client = Object.assign(new FakeMqttClient(), { connected: false });
  const runtime = new MqttRuntime(
    registry,
    async () => undefined,
    { connected: false },
    undefined,
    undefined,
    ((_url: Parameters<MqttConnector>[0], connectionOptions: Parameters<MqttConnector>[1]) => {
      options = connectionOptions;
      return client;
    }) as unknown as MqttConnector,
  );
  try {
    const settings = { ...defaultMqttSettings(), url: 'mqtts://localhost', ca: caPath, cert, key };
    await runtime.apply(settings, homeAssistant);
    expect(options).toMatchObject({ ca, cert, key });
    expect(
      runtime.apply({ ...settings, ca: join(directory, 'missing.crt') }, homeAssistant),
    ).rejects.toThrow();
    expect(client.endCalls).toBe(0);
  } finally {
    const stopping = runtime.stop();
    await new Promise((resolve) => setTimeout(resolve, 0));
    client.endCallback?.();
    await stopping;
    await rm(directory, { recursive: true, force: true });
  }
});
