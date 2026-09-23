import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { d2ValueToFanState } from './profiles/D2-50-00/fan';
import { DeviceRegistry } from './devices/registry';
import { applyRadioPacket } from './devices/inbound';
import type { MqttClientLike } from './mqtt';
import { MqttEntityBridge } from './integrations/homeassistant/bridge';
import { a5Profile } from './profiles';
import { sendDeviceCommand } from './devices/commands';

class FakeMqttClient implements MqttClientLike {
  connected = true;
  published: Array<{
    topic: string;
    payload: string;
    options: { qos: 1; retain: boolean };
  }> = [];
  subscribed: string[] = [];
  private connectListener?: () => void;
  private messageListener?: (topic: string, payload: Buffer) => void;

  on(
    event: 'connect' | 'close' | 'message',
    listener: (() => void) | ((topic: string, payload: Buffer) => void),
  ): this {
    if (event === 'connect') this.connectListener = listener as () => void;
    if (event === 'message')
      this.messageListener = listener as (topic: string, payload: Buffer) => void;
    return this;
  }

  publish(
    topic: string,
    payload: string,
    options: { qos: 1; retain: boolean },
    callback?: (error?: Error) => void,
  ): void {
    this.published.push({ topic, payload, options: { ...options } });
    callback?.();
  }

  subscribe(topic: string, _options: { qos: 1 }, callback?: (error?: Error) => void): void {
    this.subscribed.push(topic);
    callback?.();
  }

  send(topic: string, payload: string): void {
    this.messageListener?.(topic, Buffer.from(payload));
  }

  reconnect(): void {
    this.connected = true;
    this.connectListener?.();
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
  'exposes A5-20-06 climate state and queued MQTT commands (Home Assistant: %s)',
  async (enabled) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-heating-'));
    const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
    const client = new FakeMqttClient();
    const bridge = new MqttEntityBridge(
      client,
      registry,
      (device, request) =>
        sendDeviceCommand(
          () => {
            throw new Error('Transport is disconnected');
          },
          registry,
          device,
          request,
        ),
      {
        homeAssistant: { enabled, discoveryTopic: 'homeassistant', statusTopic: 'eep/status' },
      },
    );
    const base = 'eep/climate/ffe76685';
    try {
      await registry.upsert({
        sourceId: 0xffe76685,
        targetId: 0x05010203,
        name: 'Heating',
        profileId: 'A5-20-06',
        capabilities: a5Profile.defaultCapabilities(),
        availability: 'online',
      });
      bridge.start();
      await bridge.publishAll();
      expect(
        JSON.parse(
          client.published.filter((message) => message.topic === `${base}/state`).at(-1)!.payload,
        ),
      ).toMatchObject({
        targetTemperature: 21,
        requestedValvePosition: null,
        currentTemperature: null,
        flowTemperature: null,
        localTemperatureOffset: null,
        energyStorageLow: null,
        valvePosition: null,
      });
      const discovery = client.published
        .filter((message) => message.topic === 'homeassistant/climate/ffe76685/config')
        .at(-1)!;
      if (enabled) {
        expect(JSON.parse(discovery.payload)).toMatchObject({
          temperature_command_topic: `${base}/temperature/set`,
          current_temperature_topic: `${base}/state`,
          mode_command_topic: `${base}/mode/set`,
          modes: ['off', 'heat'],
          min_temp: 0,
          max_temp: 40,
          temp_step: 0.5,
        });
        expect(JSON.parse(discovery.payload).state_topic).toBeUndefined();
      } else expect(discovery.payload).toBe('');
      for (const [kind, key, fields] of [
        ['number', 'valve_target', { min: 0, max: 100, step: 1, command_topic: `${base}/command` }],
        ['sensor', 'valve_position', { unit_of_measurement: '%' }],
        ['sensor', 'ambient_temperature', { device_class: 'temperature' }],
        ['sensor', 'flow_temperature', { device_class: 'temperature' }],
        ['sensor', 'local_offset', { unit_of_measurement: 'K' }],
        ['binary_sensor', 'energy_storage_low', { device_class: 'battery' }],
        ['switch', 'summer_mode', { command_topic: `${base}/command` }],
      ] as const) {
        const config = client.published
          .filter((message) => message.topic === `homeassistant/${kind}/ffe76685_${key}/config`)
          .at(-1)!;
        if (enabled) {
          const payload = JSON.parse(config.payload);
          expect(payload).toMatchObject({
            ...fields,
            state_topic: `${base}/state`,
            unique_id: `eep_${kind}_ffe76685_${key}`,
            default_entity_id: `${kind}.heating_${key}`,
            device: JSON.parse(discovery.payload).device,
            availability: JSON.parse(discovery.payload).availability,
          });
          expect(payload.temperature_command_topic).toBeUndefined();
          expect(payload.modes).toBeUndefined();
        } else expect(config.payload).toBe('');
      }
      expect(client.subscribed).toContain(`${base}/command`);
      expect(client.subscribed).toContain(`${base}/temperature/set`);
      expect(client.subscribed).toContain(`${base}/mode/set`);
      await applyRadioPacket(
        { RORG: 0xa5, senderId: 0x05010203, payload: [22, 0xaa, 40, 0x68] },
        registry,
      );
      await bridge.publishAll();
      expect(
        JSON.parse(
          client.published.filter((message) => message.topic === `${base}/state`).at(-1)!.payload,
        ),
      ).toMatchObject({ currentTemperature: 20, targetTemperature: 21, valvePosition: 22 });
      await applyRadioPacket(
        { RORG: 0xa5, senderId: 0x05010203, payload: [35, 0x7d, 51, 0xa8] },
        registry,
      );
      await bridge.publishAll();
      expect(
        JSON.parse(
          client.published.filter((message) => message.topic === `${base}/state`).at(-1)!.payload,
        ),
      ).toMatchObject({
        currentTemperature: null,
        flowTemperature: 25.5,
        localTemperatureOffset: -3,
        energyStorageLow: false,
        valvePosition: 35,
        requestedValvePosition: 35,
        targetTemperature: 21,
        hvacMode: 'off',
      });
      for (const [topic, payload, expected] of [
        ['temperature/set', '23.5', { mode: 'temperature', setpoint: 23.5 }],
        ['mode/set', 'off', { mode: 'valvePosition', setpoint: 0, standby: false }],
        ['mode/set', 'heat', { mode: 'temperature', setpoint: 23.5, standby: false }],
        [
          'command',
          '{"mode":"valvePosition","setpoint":45,"communicationInterval":10}',
          { mode: 'valvePosition', setpoint: 45, communicationInterval: 10 },
        ],
        ['command', '{"summerMode":true}', { summerMode: true, setpoint: 45 }],
        [
          'command',
          '{"mode":"valvePosition","setpoint":70,"standby":false,"summerMode":false}',
          { mode: 'valvePosition', setpoint: 70, summerMode: false, valveSetpoint: 70 },
        ],
        ['mode/set', 'heat', { mode: 'temperature', setpoint: 23.5, valveSetpoint: 70 }],
        ['mode/set', 'off', { mode: 'valvePosition', setpoint: 0, valveSetpoint: 0 }],
        [
          'command',
          '{"mode":"valvePosition","setpoint":45,"standby":false,"summerMode":false}',
          { mode: 'valvePosition', setpoint: 45, valveSetpoint: 45 },
        ],
      ] as const) {
        const updated = new Promise<void>((resolve) => {
          const unsubscribe = registry.onChange(() => {
            unsubscribe();
            resolve();
          });
        });
        client.send(`${base}/${topic}`, payload);
        await updated;
        expect(registry.findBySourceId(0xffe76685)?.desiredState).toMatchObject(expected);
        await bridge.publishAll();
        if ('valveSetpoint' in expected) {
          expect(
            JSON.parse(
              client.published.filter((message) => message.topic === `${base}/state`).at(-1)!
                .payload,
            ),
          ).toMatchObject({
            requestedValvePosition: expected.valveSetpoint,
            hvacMode: expected.mode === 'temperature' ? 'heat' : 'off',
            targetTemperature: 23.5,
            valvePosition: 35,
          });
        }
      }
    } finally {
      await bridge.stop();
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('maintains mixed-domain actuator discovery on rename, reconnect and removal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-heating-lifecycle-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const client = new FakeMqttClient();
  const bridge = new MqttEntityBridge(client, registry, async () => undefined, {
    baseTopic: 'custom',
    forceDisableRetain: true,
    homeAssistant: { enabled: true, discoveryTopic: 'ha/custom', statusTopic: 'custom/status' },
  });
  const entries = [
    ['climate', ''],
    ['number', '_valve_target'],
    ['sensor', '_valve_position'],
    ['sensor', '_ambient_temperature'],
    ['sensor', '_flow_temperature'],
    ['sensor', '_local_offset'],
    ['binary_sensor', '_energy_storage_low'],
    ['switch', '_summer_mode'],
  ];
  try {
    await registry.upsert({
      sourceId: 0xffe76685,
      targetId: 0x05010203,
      name: 'Heating',
      profileId: 'A5-20-06',
      capabilities: a5Profile.defaultCapabilities(),
      availability: 'online',
    });
    bridge.start();
    await bridge.publishAll();
    client.published = [];
    await registry.update(0xffe76685, { name: 'Bathroom valve' });
    await bridge.publishAll();
    for (const [kind, suffix] of entries) {
      const messages = client.published.filter(
        (message) => message.topic === `ha/custom/${kind}/ffe76685${suffix}/config`,
      );
      expect(messages[0]).toMatchObject({ payload: '', options: { retain: true } });
      expect(messages.at(-1)?.options.retain).toBe(false);
      expect(JSON.parse(messages.at(-1)!.payload)).toMatchObject({
        unique_id: `eep_${kind}_ffe76685${suffix}`,
        default_entity_id: `${kind}.bathroom_valve${suffix}`,
        availability: [
          { topic: 'custom/status' },
          { topic: 'custom/climate/ffe76685/availability' },
        ],
      });
    }
    client.published = [];
    client.reconnect();
    await bridge.publishAll();
    for (const [kind, suffix] of entries) {
      const messages = client.published.filter(
        (message) => message.topic === `ha/custom/${kind}/ffe76685${suffix}/config`,
      );
      expect(messages.at(-1)?.payload).not.toBe('');
    }
    client.published = [];
    await registry.remove(0xffe76685);
    await bridge.publishAll();
    for (const [kind, suffix] of entries) {
      expect(
        client.published
          .filter((message) => message.topic === `ha/custom/${kind}/ffe76685${suffix}/config`)
          .at(-1),
      ).toMatchObject({ payload: '', options: { qos: 1, retain: true } });
    }
  } finally {
    await bridge.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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

test.each([true, false])(
  'publishes F6-02-01 press/release state and button details (Home Assistant: %s)',
  async (enabled) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-rocker-'));
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
        name: 'Wall rocker',
        profileId: 'F6-02-01',
        capabilities: ['rocker'],
        availability: 'unknown',
      });
      bridge.start();
      await bridge.publishAll();
      expect(
        client.published.filter((message) => message.topic === stateTopic).at(-1)?.payload,
      ).toBe(JSON.stringify({ state: 'OFF' }));
      expect(
        client.published
          .filter((message) => message.topic === 'eep/binary_sensor/ffe76685/availability')
          .at(-1)?.payload,
      ).toBe('offline');
      const discovery = client.published
        .filter((message) => message.topic === 'homeassistant/binary_sensor/ffe76685/config')
        .at(-1);
      expect(discovery?.payload).toBe('');
      const configurations = client.published.filter(
        (message) => message.topic.startsWith('homeassistant/binary_sensor/') && message.payload,
      );
      expect(configurations).toHaveLength(enabled ? 4 : 0);
      for (const button of ['AI', 'A0', 'BI', 'B0']) {
        const key = button.toLowerCase();
        const message = client.published
          .filter((item) => item.topic === `homeassistant/binary_sensor/ffe76685_${key}/config`)
          .at(-1);
        if (enabled) {
          const configuration = JSON.parse(message?.payload ?? '{}');
          expect(configuration).toMatchObject({
            name: button,
            unique_id: `eep_binary_sensor_ffe76685_${key}`,
            object_id: `wall_rocker_${key}`,
            default_entity_id: `binary_sensor.wall_rocker_${key}`,
            state_topic: stateTopic,
            value_template: `{{ 'ON' if value_json.messageType | default('') == 'N' and value_json.pressed | default(false) and '${button}' in value_json.buttons | default([]) else 'OFF' }}`,
            json_attributes_topic: stateTopic,
            device: { identifiers: ['eep_ffe76685'], name: 'Wall rocker' },
            availability: [
              { topic: 'eep/status' },
              { topic: 'eep/binary_sensor/ffe76685/availability' },
            ],
            availability_mode: 'all',
          });
          expect(configuration.command_topic).toBeUndefined();
          expect(configuration.device_class).toBeUndefined();
        } else {
          expect(message?.payload).toBe('');
        }
      }
      expect(client.subscribed.some((topic) => topic.includes('/binary_sensor/'))).toBe(false);
      for (const { data, status, expected } of [
        {
          data: 0x10,
          status: 0x30,
          expected: { state: 'ON', messageType: 'N', pressed: true, buttons: ['AI'] },
        },
        {
          data: 0x30,
          status: 0x30,
          expected: { state: 'ON', messageType: 'N', pressed: true, buttons: ['A0'] },
        },
        {
          data: 0x50,
          status: 0x30,
          expected: { state: 'ON', messageType: 'N', pressed: true, buttons: ['BI'] },
        },
        {
          data: 0x70,
          status: 0x30,
          expected: { state: 'ON', messageType: 'N', pressed: true, buttons: ['B0'] },
        },
        {
          data: 0x70,
          status: 0x30,
          expected: { state: 'ON', messageType: 'N', pressed: true, buttons: ['B0'] },
        },
        {
          data: 0x60,
          status: 0x30,
          expected: { state: 'OFF', messageType: 'N', pressed: false, buttons: ['B0'] },
        },
        {
          data: 0x35,
          status: 0x30,
          expected: { state: 'ON', messageType: 'N', pressed: true, buttons: ['A0', 'BI'] },
        },
        {
          data: 0x70,
          status: 0x20,
          expected: { state: 'ON', messageType: 'U', pressed: true, buttonCount: '3_or_4' },
        },
        {
          data: 0,
          status: 0x20,
          expected: { state: 'OFF', messageType: 'U', pressed: false, buttonCount: 0 },
        },
      ]) {
        await applyRadioPacket(
          { RORG: 0xf6, senderId: '05010203', payload: [data], status },
          registry,
        );
        await bridge.publishAll();
        expect(
          JSON.parse(
            client.published.filter((message) => message.topic === stateTopic).at(-1)?.payload ??
              '{}',
          ),
        ).toEqual(expected);
      }
    } finally {
      await bridge.stop();
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test.each([true, false])(
  'maintains all rocker discovery entries through lifecycle changes (retain: %s)',
  async (retain) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-mqtt-rocker-lifecycle-'));
    const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
    const client = new FakeMqttClient();
    const settings = {
      baseTopic: 'custom',
      forceDisableRetain: !retain,
      homeAssistant: { enabled: true, discoveryTopic: 'ha/custom', statusTopic: 'custom/status' },
    };
    let bridge = new MqttEntityBridge(client, registry, async () => undefined, settings);
    const buttons = ['AI', 'A0', 'BI', 'B0'];
    const lastMessage = (topic: string) =>
      client.published.filter((message) => message.topic === topic).at(-1);
    const expectCleared = (id: string) => {
      for (const suffix of ['', ...buttons.map((button) => `_${button.toLowerCase()}`)]) {
        expect(lastMessage(`ha/custom/binary_sensor/${id}${suffix}/config`)).toMatchObject({
          payload: '',
          options: { qos: 1, retain: true },
        });
      }
    };
    const expectDiscovery = (id: string, name: string) => {
      expect(lastMessage(`ha/custom/binary_sensor/${id}/config`)?.payload).toBe('');
      for (const button of buttons) {
        const key = button.toLowerCase();
        const message = lastMessage(`ha/custom/binary_sensor/${id}_${key}/config`);
        expect(message?.options).toEqual({ qos: 1, retain });
        expect(JSON.parse(message?.payload ?? '{}')).toMatchObject({
          name: button,
          unique_id: `eep_binary_sensor_${id}_${key}`,
          object_id: `${name}_${key}`,
          default_entity_id: `binary_sensor.${name}_${key}`,
          state_topic: `custom/binary_sensor/${id}/state`,
          device: { identifiers: [`eep_${id}`] },
        });
      }
    };
    try {
      bridge.start();
      await registry.upsert({
        sourceId: 0xffe76685,
        targetId: 0x05010203,
        name: 'Wall rocker',
        profileId: 'F6-02-01',
        capabilities: ['rocker'],
        availability: 'online',
      });
      await bridge.publishAll();
      expectDiscovery('ffe76685', 'wall_rocker');

      client.published = [];
      await registry.update(0xffe76685, { name: 'Bedroom rocker' });
      await bridge.publishAll();
      expectDiscovery('ffe76685', 'bedroom_rocker');
      for (const button of buttons) {
        const messages = client.published.filter(
          (message) =>
            message.topic === `ha/custom/binary_sensor/ffe76685_${button.toLowerCase()}/config`,
        );
        expect(messages[0]).toMatchObject({ payload: '', options: { retain: true } });
      }

      client.published = [];
      await registry.reassignSourceId(0xffe76685, 0xffe76686);
      await bridge.publishAll();
      expectCleared('ffe76685');
      expectDiscovery('ffe76686', 'bedroom_rocker');

      await applyRadioPacket(
        { RORG: 0xf6, senderId: '05010203', payload: [0x15], status: 0x30 },
        registry,
      );
      await bridge.publishAll();
      const stateTopic = 'custom/binary_sensor/ffe76686/state';
      const pressedState = JSON.stringify({
        messageType: 'N',
        pressed: true,
        buttons: ['AI', 'BI'],
        state: 'ON',
      });
      expect(lastMessage(stateTopic)?.payload).toBe(pressedState);
      client.connected = false;
      client.published = [];
      client.reconnect();
      await bridge.publishAll();
      expectDiscovery('ffe76686', 'bedroom_rocker');
      expect(lastMessage(stateTopic)?.payload).toBe(pressedState);

      const shutdownStart = client.published.length;
      await bridge.stop();
      expectDiscovery('ffe76686', 'bedroom_rocker');
      expect(lastMessage('custom/status')).toMatchObject({
        payload: 'offline',
        options: { qos: 1, retain },
      });
      expect(lastMessage('custom/binary_sensor/ffe76686/availability')?.payload).toBe('offline');
      expect(
        client.published.slice(shutdownStart).some((message) => message.topic.endsWith('/config')),
      ).toBe(false);
      bridge = new MqttEntityBridge(client, registry, async () => undefined, {
        ...settings,
        homeAssistant: { ...settings.homeAssistant, enabled: false },
      });
      client.published = [];
      bridge.start();
      await bridge.publishAll();
      expectCleared('ffe76686');
      expect(lastMessage(stateTopic)?.payload).toBe(pressedState);
      expect(
        client.published.some((message) => message.topic.endsWith('/config') && message.payload),
      ).toBe(false);

      await bridge.stop();
      bridge = new MqttEntityBridge(client, registry, async () => undefined, settings);
      bridge.start();
      await bridge.publishAll();
      expectDiscovery('ffe76686', 'bedroom_rocker');
      client.published = [];
      await registry.remove(0xffe76686);
      await bridge.publishAll();
      expectCleared('ffe76686');
      for (const field of ['eep', 'sender_id', 'target_id']) {
        expect(lastMessage(`ha/custom/sensor/eep_ffe76686_${field}/config`)).toMatchObject({
          payload: '',
          options: { retain: true },
        });
      }
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

test('publishes D2 ventilation measurements as Home Assistant sensors', async () => {
  const { bridge, client, registry } = await createBridge();
  try {
    const fanDiscovery = client.published.find(
      (entry) => entry.topic === 'homeassistant/fan/ffe76681/config' && entry.payload,
    );
    expect(fanDiscovery).toBeDefined();
    expect(JSON.parse(fanDiscovery?.payload ?? '{}')).toMatchObject({
      command_topic: 'eep/fan/ffe76681/command',
      state_value_template: '{{ value_json.state }}',
      percentage_command_topic: 'eep/fan/ffe76681/percentage/set',
      speed_range_min: 1,
      speed_range_max: 4,
      preset_mode_command_topic: 'eep/fan/ffe76681/preset/set',
      preset_modes: ['Automatic', 'Supply', 'Exhaust'],
    });
    const sensors = [
      ['air_quality', { unit_of_measurement: '%', value_template: '{{ value_json.airQuality }}' }],
      [
        'outdoor_temperature',
        {
          device_class: 'temperature',
          unit_of_measurement: '\u00b0C',
          value_template: '{{ value_json.outdoorTemperature }}',
        },
      ],
      [
        'supply_air_temperature',
        {
          device_class: 'temperature',
          unit_of_measurement: '\u00b0C',
          value_template: '{{ value_json.supplyAirTemperature }}',
        },
      ],
      [
        'supply_air_flow',
        { unit_of_measurement: 'm3/h', value_template: '{{ value_json.supplyAirFlow }}' },
      ],
      [
        'exhaust_air_flow',
        { unit_of_measurement: 'm3/h', value_template: '{{ value_json.exhaustAirFlow }}' },
      ],
      [
        'supply_fan_speed',
        { unit_of_measurement: 'rpm', value_template: '{{ value_json.supplyFanSpeed }}' },
      ],
      [
        'exhaust_fan_speed',
        { unit_of_measurement: 'rpm', value_template: '{{ value_json.exhaustFanSpeed }}' },
      ],
    ] as const;

    for (const [key, fields] of sensors) {
      const message = client.published
        .filter((entry) => entry.topic === `homeassistant/sensor/ffe76681_${key}/config`)
        .at(-1);
      expect(message).toBeDefined();
      expect(JSON.parse(message?.payload ?? '{}')).toMatchObject({
        ...fields,
        state_topic: 'eep/fan/ffe76681/state',
        unique_id: `eep_sensor_ffe76681_${key}`,
      });
    }

    await registry.update(0xffe76681, {
      availability: 'online',
      reportedState: {
        isOn: true,
        percentage: 25,
        d2Value: 1,
        airQuality: 22,
        outdoorTemperature: 15,
        supplyAirTemperature: 20,
        supplyAirFlow: 17,
        exhaustAirFlow: 17,
        supplyFanSpeed: 564,
        exhaustFanSpeed: 480,
      },
    });
    await bridge.publishAll();

    expect(
      JSON.parse(
        client.published.filter((entry) => entry.topic === 'eep/fan/ffe76681/state').at(-1)!
          .payload,
      ),
    ).toMatchObject({
      state: 'ON',
      airQuality: 22,
      outdoorTemperature: 15,
      supplyAirTemperature: 20,
      supplyAirFlow: 17,
      exhaustAirFlow: 17,
      supplyFanSpeed: 564,
      exhaustFanSpeed: 480,
    });
  } finally {
    await bridge.stop({ publishOffline: false });
    await registry.close();
  }
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
        .filter((message) => message.topic.endsWith('/config') && message.payload)
        .map((message) => message.topic),
    )) {
      expect(
        client.published.filter((message) => message.topic === topic).at(-1)?.payload,
      ).not.toBe('');
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

test('preserves Home Assistant discovery and publishes offline availability when the bridge stops', async () => {
  const { bridge, client, registry } = await createBridge();
  try {
    const discovery = client.published.filter(
      (message) => message.topic.endsWith('/config') && message.payload,
    );
    expect(discovery.length).toBeGreaterThan(0);
    const shutdownStart = client.published.length;
    await bridge.stop();

    expect(client.published.slice(shutdownStart)).not.toHaveLength(0);
    for (const message of client.published.slice(shutdownStart)) {
      expect(message.topic.endsWith('/config')).toBe(false);
      expect(message.payload).toBe('offline');
      expect(message.options).toEqual({ qos: 1, retain: true });
    }
    for (const configuration of discovery) {
      expect(
        client.published.filter((message) => message.topic === configuration.topic).at(-1),
      ).toEqual(configuration);
      const entity = JSON.parse(configuration.payload);
      for (const availability of entity.availability) {
        expect(
          client.published.filter((message) => message.topic === availability.topic).at(-1),
        ).toMatchObject({ payload: 'offline', options: { qos: 1, retain: true } });
      }
    }
  } finally {
    await bridge.stop();
    await registry.close();
  }
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
