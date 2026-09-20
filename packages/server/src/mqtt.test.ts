import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d2ValueToFanState } from './profiles/D2-50-00/fan';
import { DeviceRegistry } from './devices/registry';
import { applyRadioPacket } from './devices/inbound';
import { TeachInManager } from './devices/teachin';
import type { MqttClientLike } from './mqtt';
import { MqttEntityBridge } from './integrations/homeassistant/bridge';

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
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const client = new FakeMqttClient();
  const commands: number[] = [];
  const bridge = new MqttEntityBridge(client, registry, async (device, value) => {
    const d2Value = typeof value === 'number' ? value : (value as { value: number }).value;
    commands.push(d2Value);
    await registry.update(device.sourceId, {
      desiredState: d2ValueToFanState(d2Value),
      availability: 'online',
    });
  });
  bridge.start();
  await bridge.publishAll();
  return { bridge, client, commands, registry };
}

test.each([true, false])(
  'publishes D5-00-01 contact state (Home Assistant: %s)',
  async (enabled) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-contact-'));
    const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
    const client = new FakeMqttClient();
    const bridge = new MqttEntityBridge(client, registry, async () => undefined, {
      homeAssistant: { enabled, discoveryTopic: 'homeassistant', statusTopic: 'eep/status' },
    });
    const stateTopic = 'eep/binary_sensor/ffe76685/state';
    try {
      await registry.upsert({
        sourceId: 0xffe76685,
        targetId: 0x05010203,
        name: 'Window contact',
        profileId: 'D5-00-01',
        capabilities: ['contact'],
        availability: 'online',
      });
      await bridge.publishAll();
      expect(client.published.some((message) => message.topic === stateTopic)).toBe(false);
      const discovery = client.published
        .filter((message) => message.topic === 'homeassistant/binary_sensor/ffe76685/config')
        .at(-1);
      if (enabled) {
        const configuration = JSON.parse(discovery?.payload ?? '{}');
        expect(configuration).toMatchObject({
          device_class: 'opening',
          state_topic: stateTopic,
          unique_id: 'eep_binary_sensor_ffe76685',
        });
        expect(configuration.command_topic).toBeUndefined();
        expect(configuration.percentage_command_topic).toBeUndefined();
      } else {
        expect(discovery?.payload).toBe('');
      }
      expect(client.subscribed.some((topic) => topic.includes('/binary_sensor/'))).toBe(false);
      for (const { data, expected } of [
        { data: 0x08, expected: 'ON' },
        { data: 0x09, expected: 'OFF' },
      ]) {
        await applyRadioPacket({ RORG: 0xd5, senderId: '05010203', payload: [data] }, registry);
        await bridge.publishAll();
        expect(
          client.published.filter((message) => message.topic === stateTopic).at(-1)?.payload,
        ).toBe(expected);
      }
      expect(
        await applyRadioPacket({ RORG: 0xd5, senderId: '05010203', payload: [0x00] }, registry),
      ).toBeUndefined();
      await bridge.publishAll();
      expect(
        client.published.filter((message) => message.topic === stateTopic).at(-1)?.payload,
      ).toBe('OFF');
    } finally {
      await bridge.stop();
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('publishes Home Assistant fan discovery for seeded devices', async () => {
  const { client } = await createBridge();
  const discovery = client.published
    .filter((message) => message.topic === 'homeassistant/fan/ffe76681/config')
    .at(-1);

  expect(discovery).toBeDefined();
  const configuration = JSON.parse(discovery?.payload ?? '{}');
  expect(configuration).toMatchObject({
    unique_id: 'eep_fan_ffe76681',
    object_id: 'living_room_vent',
    default_entity_id: 'fan.living_room_vent',
    device: { via_device: 'eep_bridge' },
    percentage_command_topic: 'eep/fan/ffe76681/percentage/set',
    speed_range_min: 1,
    speed_range_max: 4,
    availability: [{ topic: 'eep/status' }, { topic: 'eep/fan/ffe76681/availability' }],
    availability_mode: 'all',
    preset_modes: ['Automatic', 'Supply', 'Exhaust'],
  });
  expect(configuration.name).toBeNull();
  expect(configuration.device.name).toBe('Living Room vent');
  expect(configuration.payload_reset_preset_mode).toBe('None');
  const eepDiagnostic = client.published.find(
    (message) => message.topic === 'homeassistant/sensor/eep_ffe76681_eep/config',
  );
  expect(JSON.parse(eepDiagnostic?.payload ?? '{}')).toMatchObject({
    unique_id: 'eep_ffe76681_eep',
    state_topic: 'eep/device/ffe76681/eep/state',
    entity_category: 'diagnostic',
    availability_mode: 'all',
  });
  expect(
    client.published.find((message) => message.topic === 'eep/device/ffe76681/eep/state')?.payload,
  ).toBe('D2-50-00');
  expect(
    client.published.find((message) => message.topic === 'homeassistant/fan/0513cefe/config')
      ?.payload,
  ).toBeUndefined();
  expect(
    client.published.find(
      (message) => message.topic === 'homeassistant/button/eep_bridge_restart/config',
    )?.payload,
  ).toBeUndefined();
});

test('shutdown waits for in-flight discovery before publishing final offline state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-stop-inflight-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const client = new FakeMqttClient();
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const publish = client.publish.bind(client);
  client.publish = (topic, payload, options, callback) => {
    if (topic === 'eep/status' && payload === 'online') {
      started.resolve();
      void release.promise.then(() => publish(topic, payload, options, callback));
    } else publish(topic, payload, options, callback);
  };
  const bridge = new MqttEntityBridge(client, registry, async () => undefined);
  bridge.start();
  try {
    const publication = bridge.publishAll();
    await started.promise;
    const shutdown = bridge.stop();
    release.resolve();
    await Promise.all([publication, shutdown]);
    expect(
      client.published.filter((message) => message.topic === 'eep/status').at(-1)?.payload,
    ).toBe('offline');
    for (const topic of new Set(
      client.published
        .filter((message) => message.topic.endsWith('/config'))
        .map((message) => message.topic),
    )) {
      expect(client.published.filter((message) => message.topic === topic).at(-1)?.payload).toBe(
        '',
      );
    }
  } finally {
    release.resolve();
    await bridge.stop();
    await registry.close();
  }
});

test('publishes updated state when a device changes', async () => {
  const { client, registry } = await createBridge();
  await registry.update(0xffe76681, { availability: 'online' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const discoveryMessages = client.published.filter(
    (message) => message.topic === 'homeassistant/fan/ffe76681/config',
  );
  expect(discoveryMessages.length).toBeGreaterThan(1);
});

test('recreates an entity when its friendly name changes', async () => {
  const { client, registry } = await createBridge();

  await registry.update(0xffe76681, { name: 'Bedroom Vent' });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const discoveryMessages = client.published.filter(
    (message) => message.topic === 'homeassistant/fan/ffe76681/config',
  );
  expect(discoveryMessages.some((message) => message.payload === '')).toBe(true);
  const configuration = JSON.parse(discoveryMessages.at(-1)?.payload ?? '{}');
  expect(configuration).toMatchObject({
    unique_id: 'eep_fan_ffe76681',
    object_id: 'bedroom_vent',
    default_entity_id: 'fan.bedroom_vent',
    device: { name: 'Bedroom Vent' },
  });
});

test('publishes discovery when a device is paired after MQTT starts', async () => {
  const { client, registry } = await createBridge();
  const existing = registry.findByTargetId(0x0513cefe);
  if (!existing) throw new Error('Expected seeded device');

  await registry.upsert({
    ...existing,
    sourceId: 0xffe76685,
    targetId: 0x05126790,
    reportedState: undefined,
  });
  await new Promise((resolve) => setTimeout(resolve, 50));

  const discovery = client.published
    .filter((message) => message.topic === 'homeassistant/fan/ffe76685/config')
    .at(-1);
  expect(discovery).toBeDefined();
  expect(JSON.parse(discovery?.payload ?? '{}')).toMatchObject({
    unique_id: 'eep_fan_ffe76685',
    object_id: 'living_room_vent',
    default_entity_id: 'fan.living_room_vent',
    device: { via_device: 'eep_bridge' },
    state_topic: 'eep/fan/ffe76685/state',
  });
});

test('clears retained discovery when a device is removed', async () => {
  const { bridge, client, registry } = await createBridge();

  await registry.remove(0xffe76681);
  await new Promise((resolve) => setTimeout(resolve, 50));

  expect(
    client.published
      .filter((message) => message.topic === 'homeassistant/fan/ffe76681/config')
      .at(-1)?.payload,
  ).toBe('');
  await bridge.stop();
});

test('reassigning a sender channel removes old discovery before exposing the new channel', async () => {
  const { bridge, client, registry } = await createBridge();
  try {
    await registry.reassignSourceId(0xffe76681, 0xffe76685);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(
      client.published
        .filter((message) => message.topic === 'homeassistant/fan/ffe76681/config')
        .at(-1)?.payload,
    ).toBe('');
    expect(
      client.published
        .filter((message) => message.topic === 'homeassistant/sensor/eep_ffe76681_eep/config')
        .at(-1)?.payload,
    ).toBe('');
    expect(
      JSON.parse(
        client.published
          .filter((message) => message.topic === 'homeassistant/fan/ffe76685/config')
          .at(-1)?.payload ?? '{}',
      ),
    ).toMatchObject({ unique_id: 'eep_fan_ffe76685' });
  } finally {
    await bridge.stop();
    await registry.close();
  }
});

test('uses configured Home Assistant topics and keeps unknown devices unavailable', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-topics-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const client = new FakeMqttClient();
  const bridge = new MqttEntityBridge(client, registry, async () => undefined, {
    baseTopic: 'custom',
    homeAssistant: {
      enabled: true,
      discoveryTopic: 'ha/config',
      statusTopic: 'ha/status',
    },
  });

  bridge.start();
  await bridge.publishAll();

  expect(client.published.find((message) => message.topic === 'ha/status')?.payload).toBe('online');
  expect(
    client.published.find((message) => message.topic === 'ha/config/fan/ffe76681/config'),
  ).toBeDefined();
  expect(
    client.published.find((message) => message.topic === 'custom/fan/ffe76681/availability')
      ?.payload,
  ).toBe('offline');
});

test('maps fan MQTT commands to D2 values', async () => {
  const { client, commands } = await createBridge();
  client.send('eep/fan/ffe76681/percentage/set', '54');
  client.send('eep/fan/ffe76681/percentage/set', '75');
  client.send('eep/fan/ffe76681/percentage/set', '3');
  client.send('eep/fan/ffe76681/command', 'ON');
  client.send('eep/fan/ffe76681/command', 'OFF');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(commands).toEqual([3, 1, 0]);
});

test('keeps MQTT state and commands active when Home Assistant is disabled', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-without-ha-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  await registry.update(0xffe76681, { availability: 'online' });
  const client = new FakeMqttClient();
  const commands: number[] = [];
  const bridge = new MqttEntityBridge(
    client,
    registry,
    async (_device, value) => {
      commands.push(typeof value === 'number' ? value : (value as { value: number }).value);
    },
    {
      baseTopic: 'eep',
      homeAssistant: {
        enabled: false,
        discoveryTopic: 'homeassistant',
        statusTopic: 'eep/status',
      },
    },
  );

  bridge.start();
  await bridge.publishAll();
  client.send('eep/fan/ffe76681/percentage/set', '3');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(
    client.published.find((message) => message.topic === 'eep/fan/ffe76681/state'),
  ).toBeDefined();
  expect(commands).toEqual([3]);
  expect(
    client.published.find((message) => message.topic === 'homeassistant/fan/ffe76681/config')
      ?.payload,
  ).toBe('');
  await bridge.stop();
});

test('rejects MQTT presets that are not configured for a device', async () => {
  const { client, commands } = await createBridge();
  client.send('eep/fan/ffe76681/preset/set', 'Automatic on demand');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(commands).toEqual([]);
});

test('publishes the updated speed after an MQTT command', async () => {
  const { client, registry } = await createBridge();
  await registry.update(0xffe76681, {
    reportedState: d2ValueToFanState(4),
  });
  client.send('eep/fan/ffe76681/percentage/set', '3');
  await new Promise((resolve) => setTimeout(resolve, 50));

  const speedStates = client.published.filter(
    (message) => message.topic === 'eep/fan/ffe76681/percentage/state',
  );
  expect(speedStates.at(-1)?.payload).toBe('3');
});

test('clears the Home Assistant preset when an MQTT speed is selected', async () => {
  const { client, registry } = await createBridge();
  await registry.update(0xffe76681, {
    availability: 'online',
    reportedState: d2ValueToFanState(11),
  });
  client.send('eep/fan/ffe76681/percentage/set', '1');
  await new Promise((resolve) => setTimeout(resolve, 50));

  const presetStates = client.published.filter(
    (message) => message.topic === 'eep/fan/ffe76681/preset/state',
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
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const client = new FakeMqttClient();
  let signalCount = 0;
  const teachIn = new TeachInManager(registry, 0xffe76685, undefined, undefined, async () => {
    signalCount += 1;
  });
  const bridge = new MqttEntityBridge(
    client,
    registry,
    async () => undefined,
    {},
    undefined,
    teachIn,
  );
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
    icon: 'mdi:access-point-network',
    device: {
      name: 'Enocean2MQTT Bridge',
      manufacturer: 'Enocean2MQTT',
      model: 'Bridge',
    },
  });
  const restartDiscovery = client.published.find(
    (message) => message.topic === 'homeassistant/button/restart/config',
  );
  expect(JSON.parse(restartDiscovery?.payload ?? '{}')).toMatchObject({
    unique_id: 'eep_restart',
    command_topic: 'eep/restart/set',
    payload_press: 'PRESS',
    icon: 'mdi:restart',
    device: { name: 'Enocean2MQTT Bridge' },
  });
  expect(
    client.published.find((message) => message.topic === 'eep/permit_join/state')?.payload,
  ).toBe('OFF');

  client.send('eep/permit_join/set', 'ON');
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(teachIn.isActive()).toBe(true);
  expect(signalCount).toBe(1);
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
    (message) => message.topic === 'eep/fan/ffe76681/availability',
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
      .filter((message) => message.topic === 'homeassistant/fan/ffe76681/config')
      .at(-1)?.payload,
  ).toBe('');
});

test('handles the Home Assistant bridge Restart button', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-restart-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const client = new FakeMqttClient();
  let restartCount = 0;
  const bridge = new MqttEntityBridge(
    client,
    registry,
    async () => undefined,
    {},
    undefined,
    undefined,
    async () => {
      restartCount += 1;
    },
  );

  bridge.start();
  await bridge.publishAll();
  client.send('eep/restart/set', 'PRESS');
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(restartCount).toBe(1);
  await bridge.stop();
});

test('ignores late commands and reconnects after bridge shutdown', async () => {
  const { bridge, client, commands } = await createBridge();
  await bridge.stop();
  const publications = client.published.length;
  client.send('eep/fan/ffe76681/command', 'ON');
  await bridge.publishAll();
  expect(commands).toEqual([]);
  expect(client.published).toHaveLength(publications);
});
