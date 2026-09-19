import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d2ValueToFanState } from './api/D2-50-00/fan';
import { DeviceRegistry } from './devices/registry';
import { MqttFanBridge, type MqttClientLike } from './mqtt';

class FakeMqttClient implements MqttClientLike {
  published: Array<{ topic: string; payload: string }> = [];
  subscribed: string[] = [];
  private messageListener?: (topic: string, payload: Buffer) => void;

  on(
    event: 'connect' | 'close' | 'message',
    listener: (() => void) | ((topic: string, payload: Buffer) => void),
  ): this {
    if (event === 'message')
      this.messageListener = listener as (topic: string, payload: Buffer) => void;
    return this;
  }

  publish(
    topic: string,
    payload: string,
    _options: { qos: 1; retain: boolean },
    callback?: (error?: Error) => void,
  ): void {
    this.published.push({ topic, payload });
    callback?.();
  }

  subscribe(topic: string, _options: { qos: 1 }, callback?: (error?: Error) => void): void {
    this.subscribed.push(topic);
    callback?.();
  }

  send(topic: string, payload: string): void {
    this.messageListener?.(topic, Buffer.from(payload));
  }
}

async function createBridge() {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  const client = new FakeMqttClient();
  const commands: number[] = [];
  const bridge = new MqttFanBridge(client, registry, async (device, value) => {
    commands.push(value);
    await registry.update(device.targetId, {
      desiredState: d2ValueToFanState(value),
      availability: 'online',
    });
  });
  bridge.start();
  await bridge.publishAll();
  return { bridge, client, commands, registry };
}

test('publishes Home Assistant fan discovery for seeded devices', async () => {
  const { client, registry } = await createBridge();
  const discovery = client.published.find(
    (message) => message.topic === 'homeassistant/fan/0513cefe/config',
  );

  expect(discovery).toBeDefined();
  const configuration = JSON.parse(discovery?.payload ?? '{}');
  expect(configuration).toMatchObject({
    unique_id: 'eep_fan_0513cefe',
    object_id: 'e04_vent',
    default_entity_id: 'fan.e04_vent',
    percentage_command_topic: 'eep/fan/0513cefe/percentage/set',
    speed_range_min: 1,
    speed_range_max: 4,
    availability: [{ topic: 'eep/status' }, { topic: 'eep/fan/0513cefe/availability' }],
    availability_mode: 'all',
    preset_modes: ['Automatic', 'Supply', 'Exhaust'],
  });
  expect(configuration.name).toBeNull();
  expect(configuration.device.name).toBe(registry.findByTargetId(0x0513cefe)?.name);
  expect(configuration.payload_reset_preset_mode).toBe('None');
});

test('republishes discovery when a device is renamed', async () => {
  const { client, registry } = await createBridge();
  await registry.update(0x0513cefe, { name: 'Living Room Vent' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const discoveryMessages = client.published.filter(
    (message) => message.topic === 'homeassistant/fan/0513cefe/config',
  );
  expect(JSON.parse(discoveryMessages.at(-1)?.payload ?? '{}').device.name).toBe(
    'Living Room Vent',
  );
});

test('uses configured Home Assistant topics and keeps unknown devices unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-topics-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  const client = new FakeMqttClient();
  const bridge = new MqttFanBridge(client, registry, async () => undefined, {
    baseTopic: 'custom',
    discoveryPrefix: 'legacy',
    homeAssistant: {
      enabled: true,
      discoveryTopic: 'ha/config',
      statusTopic: 'ha/status',
      experimentalEventEntities: false,
      legacyActionSensor: false,
    },
  });

  bridge.start();
  await bridge.publishAll();

  expect(client.published.find((message) => message.topic === 'ha/status')?.payload).toBe('online');
  expect(
    client.published.find((message) => message.topic === 'ha/config/fan/0513cefe/config'),
  ).toBeDefined();
  expect(
    client.published.find((message) => message.topic === 'custom/fan/0513cefe/availability')
      ?.payload,
  ).toBe('offline');
});

test('maps fan MQTT commands to D2 values', async () => {
  const { client, commands } = await createBridge();
  client.send('eep/fan/0513cefe/percentage/set', '54');
  client.send('eep/fan/0513cefe/percentage/set', '75');
  client.send('eep/fan/0513cefe/percentage/set', '3');
  client.send('eep/fan/0513cefe/command', 'ON');
  client.send('eep/fan/0513cefe/command', 'OFF');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(commands).toEqual([3, 3, 3, 1, 0]);
});

test('rejects MQTT presets that are not configured for a device', async () => {
  const { client, commands } = await createBridge();
  client.send('eep/fan/0513cefe/preset/set', 'Automatic on demand');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(commands).toEqual([]);
});

test('publishes the updated speed after an MQTT command', async () => {
  const { client, registry } = await createBridge();
  await registry.update(0x0513cefe, {
    reportedState: d2ValueToFanState(4),
  });
  client.send('eep/fan/0513cefe/percentage/set', '75');
  await new Promise((resolve) => setTimeout(resolve, 50));

  const speedStates = client.published.filter(
    (message) => message.topic === 'eep/fan/0513cefe/percentage/state',
  );
  expect(speedStates.at(-1)?.payload).toBe('3');
});

test('clears the Home Assistant preset when an MQTT speed is selected', async () => {
  const { client, registry } = await createBridge();
  await registry.update(0x0513cefe, {
    availability: 'online',
    reportedState: d2ValueToFanState(11),
  });
  client.send('eep/fan/0513cefe/percentage/set', '25');
  await new Promise((resolve) => setTimeout(resolve, 50));

  const presetStates = client.published.filter(
    (message) => message.topic === 'eep/fan/0513cefe/preset/state',
  );
  expect(presetStates.at(-1)?.payload).toBe('None');
  expect(registry.findByTargetId(0x0513cefe)?.desiredState).toMatchObject({
    d2Value: 1,
    percentage: 25,
  });
  expect(registry.findByTargetId(0x0513cefe)?.desiredState?.preset).toBeUndefined();
});

test('publishes offline availability when the bridge stops', async () => {
  const { bridge, client } = await createBridge();
  await bridge.stop();

  const availabilityStates = client.published.filter(
    (message) => message.topic === 'eep/fan/0513cefe/availability',
  );
  expect(availabilityStates.at(-1)?.payload).toBe('offline');
  expect(client.published.find((message) => message.topic === 'eep/status')?.payload).toBe(
    'online',
  );
  expect(client.published.filter((message) => message.topic === 'eep/status').at(-1)?.payload).toBe(
    'offline',
  );
  expect(
    client.published
      .filter((message) => message.topic === 'homeassistant/fan/0513cefe/config')
      .at(-1)?.payload,
  ).toBe('');
});
