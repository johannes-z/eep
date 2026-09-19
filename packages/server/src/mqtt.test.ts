import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d2ValueToFanState } from './api/D2-50-00/fan';
import { DeviceRegistry } from './devices/registry';
import { TeachInManager } from './devices/teachin';
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

async function createBridge(bridgeInfo: Record<string, unknown> = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  const client = new FakeMqttClient();
  const commands: number[] = [];
  const bridge = new MqttFanBridge(
    client,
    registry,
    async (device, value) => {
      const d2Value = value as number;
      commands.push(d2Value);
      await registry.update(device.targetId, {
        desiredState: d2ValueToFanState(d2Value),
        availability: 'online',
      });
    },
    {},
    undefined,
    undefined,
    bridgeInfo,
  );
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
  expect(configuration.device).toMatchObject({
    identifiers: ['eep_0513cefe'],
    connections: [['enocean', '0513cefe']],
    via_device: 'eep_bridge',
  });
  expect(configuration.payload_reset_preset_mode).toBe('None');
});

test('publishes bridge diagnostics and connected-device metadata', async () => {
  const { client } = await createBridge({
    version: '2.7.1',
  });
  const discovery = client.published.find(
    (message) => message.topic === 'homeassistant/binary_sensor/eep_bridge_connection/config',
  );
  const configuration = JSON.parse(discovery?.payload ?? '{}');

  expect(configuration).toMatchObject({
    unique_id: 'eep_bridge_connection_state',
    state_topic: 'eep/bridge/eep_bridge_connection/state',
    payload_on: 'Connected',
    payload_off: 'Disconnected',
    device_class: 'connectivity',
    entity_category: 'diagnostic',
    device: {
      identifiers: ['eep_bridge'],
      name: 'Enocean2MQTT Bridge',
      manufacturer: 'Enocean2MQTT',
      model: 'Bridge',
      sw_version: '2.7.1',
    },
  });
  expect(
    client.published.find((message) => message.topic === 'eep/bridge/eep_bridge_connection/state')
      ?.payload,
  ).toBe('Connected');
  expect(
    client.published
      .filter((message) => message.topic === 'homeassistant/sensor/eep_bridge_connection/config')
      .at(-1)?.payload,
  ).toBe('');
  expect(
    client.published.find((message) => message.topic === 'eep/bridge/eep_bridge_connection/state')
      ?.payload,
  ).toBe('Connected');
  for (const topic of [
    'homeassistant/sensor/eep_bridge_device_count/config',
    'homeassistant/sensor/eep_bridge_controller_id/config',
    'homeassistant/sensor/eep_bridge_transport/config',
    'homeassistant/sensor/eep_bridge_activity/config',
  ]) {
    expect(client.published.filter((message) => message.topic === topic).at(-1)?.payload).toBe('');
  }
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

test('publishes and applies the Home Assistant log level selector', async () => {
  const { client } = await createBridge();
  const discovery = client.published.find(
    (message) => message.topic === 'homeassistant/select/eep_bridge_log_level/config',
  );

  expect(JSON.parse(discovery?.payload ?? '{}')).toMatchObject({
    unique_id: 'eep_bridge_log_level',
    command_topic: 'eep/bridge/eep_bridge_log_level/set',
    state_topic: 'eep/bridge/eep_bridge_log_level/state',
    options: ['debug', 'info', 'warn', 'error'],
    entity_category: 'config',
  });

  client.send('eep/bridge/eep_bridge_log_level/set', 'debug');
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(
    client.published
      .filter((message) => message.topic === 'eep/bridge/eep_bridge_log_level/state')
      .at(-1)?.payload,
  ).toBe('debug');
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
  expect(registry.findByTargetId(0x0513cefe)?.desiredState).not.toMatchObject({
    preset: expect.anything(),
  });
});

test('publishes and controls the Home Assistant Permit join switch', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-pairing-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  const client = new FakeMqttClient();
  const teachIn = new TeachInManager(registry, 0xffe76685);
  const bridge = new MqttFanBridge(client, registry, async () => undefined, {}, undefined, teachIn);
  bridge.start();
  await bridge.publishAll();

  const discovery = client.published.find(
    (message) => message.topic === 'homeassistant/switch/permit_join/config',
  );
  expect(JSON.parse(discovery?.payload ?? '{}')).toMatchObject({
    unique_id: 'eep_permit_join',
    command_topic: 'eep/permit_join/set',
    state_topic: 'eep/permit_join/state',
    payload_on: 'ON',
    payload_off: 'OFF',
    state_on: 'ON',
    state_off: 'OFF',
  });
  expect(
    client.published.find((message) => message.topic === 'eep/permit_join/state')?.payload,
  ).toBe('OFF');

  client.send('eep/permit_join/set', 'ON');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(teachIn.isActive()).toBe(true);
  expect(
    client.published.filter((message) => message.topic === 'eep/permit_join/state').at(-1)?.payload,
  ).toBe('ON');

  teachIn.stop();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(
    client.published.filter((message) => message.topic === 'eep/permit_join/state').at(-1)?.payload,
  ).toBe('OFF');

  await bridge.stop();
  expect(
    client.published
      .filter((message) => message.topic === 'homeassistant/switch/permit_join/config')
      .at(-1)?.payload,
  ).toBe('');
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
