import { expect, test } from 'bun:test';
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
