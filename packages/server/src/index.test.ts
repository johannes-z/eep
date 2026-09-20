import { expect, mock, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultMqttSettings } from './mqtt';
import type { TransportSettings } from './config';
import { DeviceRegistry } from './devices/registry';
import { TeachInManager } from './devices/teachin';
import { PacketListener } from './transport/listener';
import { buildCommonCommand } from './transport/esp3';

void mock.module('bun-serialport', () => ({
  SerialPort: class {
    on() {
      return this;
    }

    async open() {}

    async write() {}
  },
}));

const { createRequestHandler } = await import('./index');

class FakeTransport {
  writes: Uint8Array[] = [];

  write(payload: Uint8Array): void {
    this.writes.push(payload);
  }
}

test('returns 200 and writes a payload for a configured device', async () => {
  const transport = new FakeTransport();
  const handler = createRequestHandler(transport);

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76681/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'Supply' }),
    }),
  );

  expect(response.status).toBe(200);
  expect(transport.writes).toHaveLength(1);
  expect(transport.writes[0]).toBeInstanceOf(Uint8Array);
  expect(transport.writes[0][6]).toBe(0xd2);
  expect(transport.writes[0][7]).toBe(13);
});

test('uses each device source ID when sending a command', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-e05-command-'));
  const transport = new FakeTransport();
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const handler = createRequestHandler(transport, {
    controllerId: 0xffe76681,
    registry,
  });

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76682/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ value: 3 }),
    }),
  );

  expect(response.status).toBe(200);
  expect(Array.from(transport.writes[0].slice(13, 17))).toEqual([0xff, 0xe7, 0x66, 0x82]);
  expect(Array.from(transport.writes[0].slice(19, 23))).toEqual([0x05, 0x12, 0x67, 0x87]);
});

test('rejects command bodies with unsafe value coercions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-command-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const handler = createRequestHandler(new FakeTransport(), { registry });

  for (const body of [{ isOn: 'false' }, { value: null }, { percentage: '50' }]) {
    const response = await handler(
      new Request('http://localhost/api/devices/ffe76681/command', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(400);
  }
});

test('rejects presets that are not configured for a device', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-command-capability-'));
  const transport = new FakeTransport();
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const handler = createRequestHandler(transport, { registry });

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76681/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'Automatic on demand' }),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: 'Device does not support function for value: 12',
  });
  expect(transport.writes).toHaveLength(0);
});

test('does not control a device removed from the persisted registry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-handler-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  await registry.remove(0xffe76681);
  const transport = new FakeTransport();
  const handler = createRequestHandler(transport, { registry });

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76681/command', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ preset: 'Supply' }),
    }),
  );

  expect(response.status).toBe(404);
  expect(transport.writes).toHaveLength(0);
});

test('rejects unknown devices and unsupported requests', async () => {
  const handler = createRequestHandler(new FakeTransport());

  expect(
    (
      await handler(
        new Request('http://localhost/api/devices/unknown/command', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ value: 3 }),
        }),
      )
    ).status,
  ).toBe(404);
  expect((await handler(new Request('http://localhost/api/devices/ffe76681/command'))).status).toBe(
    404,
  );
  expect((await handler(new Request('http://localhost/api/unsupported'))).status).toBe(404);
});

test('lists the devices from the initial configuration', async () => {
  const handler = createRequestHandler(new FakeTransport());
  const response = await handler(new Request('http://localhost/api/devices'));
  const devices = (await response.json()) as Array<{ targetId: number }>;

  expect(response.status).toBe(200);
  expect(devices).toHaveLength(4);
  expect(devices.map((device) => device.targetId)).toContain(0x0513cefe);
});

test('starts, reads, and stops the packet listener', async () => {
  const listener = new PacketListener();
  const handler = createRequestHandler(new FakeTransport(), { listener });

  const start = await handler(new Request('http://localhost/api/listen/start', { method: 'POST' }));
  expect(start.status).toBe(200);
  expect(await start.json()).toMatchObject({ active: true, packets: [] });

  listener.capture(
    { packetType: 1, data: [0xd2, 1, 2], optionalData: [3, 4] },
    {
      RORG: 0xd2,
      payload: [1, 2],
      senderId: 'ffe76681',
    },
  );
  const current = await handler(new Request('http://localhost/api/listen'));
  expect(await current.json()).toMatchObject({
    active: true,
    packets: [
      {
        direction: 'rx',
        data: 'D2 01 02',
        optionalData: '03 04',
        radio: { senderId: 'ffe76681' },
      },
    ],
  });

  listener.captureOutgoing(buildCommonCommand(0x08));
  expect(await (await handler(new Request('http://localhost/api/listen'))).json()).toMatchObject({
    packets: [{ direction: 'rx' }, { direction: 'tx', packetType: 5, data: '08' }],
  });

  const stop = await handler(new Request('http://localhost/api/listen/stop', { method: 'POST' }));
  expect(await stop.json()).toMatchObject({ active: false });
});

test('renames and persists a device through the API', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-device-name-'));
  const statePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(statePath);
  const handler = createRequestHandler(new FakeTransport(), { registry });

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76681', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'Living Room Vent' }),
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ name: 'Living Room Vent' });
  expect(registry.findBySourceId(0xffe76681)?.name).toBe('Living Room Vent');
  const restored = await DeviceRegistry.load(statePath);
  expect(restored.findBySourceId(0xffe76681)?.name).toBe('Living Room Vent');
});

test('rejects empty device names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-device-empty-name-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const handler = createRequestHandler(new FakeTransport(), { registry });

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76681', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '   ' }),
    }),
  );

  expect(response.status).toBe(400);
});

test('deletes and persists removal of a device', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-device-delete-'));
  const statePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(statePath);
  const handler = createRequestHandler(new FakeTransport(), { registry });

  const response = await handler(
    new Request('http://localhost/api/devices/ffe76681', { method: 'DELETE' }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ ok: true });
  const restored = await DeviceRegistry.load(statePath);
  expect(restored.findByTargetId(0x0513cefe)).toBeUndefined();

  const missing = await handler(
    new Request('http://localhost/api/devices/ffe76681', { method: 'DELETE' }),
  );
  expect(missing.status).toBe(404);
});

test('serves the browser console', async () => {
  const handler = createRequestHandler(new FakeTransport());
  const response = await handler(new Request('http://localhost/'));

  expect(response.status).toBe(200);
  expect(await response.text()).toContain('EnOcean2MQTT');
});

test('serves the browser console for application deep links', async () => {
  const handler = createRequestHandler(new FakeTransport());
  const response = await handler(new Request('http://localhost/settings/mqtt'));

  expect(response.status).toBe(200);
  expect(await response.text()).toContain('EnOcean2MQTT');
});

test('reads and updates MQTT settings without exposing the password', async () => {
  let savedSettings = defaultMqttSettings();
  let appliedSettings: typeof savedSettings | undefined;
  const handler = createRequestHandler(new FakeTransport(), {
    mqttSettings: { ...savedSettings, password: 'secret' },
    saveMqttSettings: async (settings) => {
      savedSettings = settings;
    },
    applyMqttSettings: async (settings) => {
      appliedSettings = settings;
    },
  });

  const initial = await handler(new Request('http://localhost/api/mqtt'));
  expect(initial.status).toBe(200);
  expect(await initial.json()).toMatchObject({ password: '', passwordConfigured: true });

  const response = await handler(
    new Request('http://localhost/api/mqtt', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        server: 'mqtt://broker.local:1883',
        user: 'homeassistant',
        base_topic: 'eep-bridge',
        keepalive: 30,
        version: 5,
      }),
    }),
  );

  expect(response.status).toBe(200);
  expect(savedSettings).toMatchObject({
    url: 'mqtt://broker.local:1883',
    username: 'homeassistant',
    password: 'secret',
    baseTopic: 'eep-bridge',
    keepalive: 30,
    version: 5,
  });
  expect(appliedSettings).toMatchObject(savedSettings);
});

test('reads and updates the general start ID', async () => {
  let savedStartId = 0xffe76681;
  let appliedStartId = 0;
  const handler = createRequestHandler(new FakeTransport(), {
    generalSettings: { startId: savedStartId },
    saveGeneralSettings: async (settings) => {
      savedStartId = settings.startId;
    },
    applyGeneralSettings: async (settings) => {
      appliedStartId = settings.startId;
    },
  });

  const initial = await handler(new Request('http://localhost/api/general'));
  expect(await initial.json()).toEqual({ start_id: 'ffe76681', base_id: null, channels: [] });

  const response = await handler(
    new Request('http://localhost/api/general', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start_id: 'ffe76685' }),
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ start_id: 'ffe76685', channels: [] });
  expect(savedStartId).toBe(0xffe76685);
  expect(appliedStartId).toBe(0xffe76685);
});

test('parses digit-only general IDs as hexadecimal', async () => {
  const handler = createRequestHandler(new FakeTransport(), {
    generalSettings: { startId: 0x10 },
  });

  const response = await handler(
    new Request('http://localhost/api/general', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ start_id: '00000010' }),
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ start_id: '00000010' });
});

test('rejects non-API command routes', async () => {
  const transport = new FakeTransport();
  const handler = createRequestHandler(transport);

  const response = await handler(new Request('http://localhost/ffe76681/0513cefe-garbage/Intake'));

  expect(response.status).toBe(404);
  expect(transport.writes).toHaveLength(0);
});

test('returns the USB 300 base ID as read-only general data', async () => {
  const handler = createRequestHandler(new FakeTransport(), {
    baseId: 0xffe76680,
    generalSettings: { startId: 0xffe76681 },
  });

  const response = await handler(new Request('http://localhost/api/general'));

  const payload = (await response.json()) as {
    start_id: string;
    base_id: string;
    channels: Array<{ channel: number; id: string; used: boolean; device?: string }>;
  };
  expect(payload.start_id).toBe('ffe76681');
  expect(payload.base_id).toBe('ffe76680');
  expect(payload.channels).toHaveLength(127);
  expect(payload.channels[0]).toMatchObject({
    channel: 1,
    id: 'ffe76681',
    used: true,
  });
  expect(payload.channels[1]).toMatchObject({
    channel: 2,
    id: 'ffe76682',
    used: true,
  });
  expect(payload.channels[4]).toMatchObject({
    channel: 5,
    id: 'ffe76685',
    used: false,
  });
});

test('starts targeted pairing from the selected USB 300 channel', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-targeted-pairing-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  let signalSourceId = 0;
  const teachIn = new TeachInManager(
    registry,
    0xffe76681,
    undefined,
    undefined,
    async (sourceId) => {
      signalSourceId = sourceId;
    },
  );
  const handler = createRequestHandler(new FakeTransport(), { registry, teachIn });

  const response = await handler(
    new Request('http://localhost/api/pairing/transmit', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sourceId: 'ffe76685' }),
    }),
  );

  expect(response.status).toBe(200);
  expect(signalSourceId).toBe(0xffe76685);
  expect(teachIn.isActive()).toBe(true);
});

test('reads and updates general transport settings', async () => {
  let savedSettings: TransportSettings = {
    type: 'serial',
    path: '/dev/ttyUSB0',
    baudRate: 115200,
    rtscts: false,
  };
  const handler = createRequestHandler(new FakeTransport(), {
    transportSettings: savedSettings,
    saveTransportSettings: async (settings) => {
      savedSettings = settings;
    },
  });

  const initial = await handler(new Request('http://localhost/api/settings'));
  expect(await initial.json()).toMatchObject({
    port: '/dev/ttyUSB0',
    baudrate: 115200,
    rtscts: false,
    connected: true,
  });

  const response = await handler(
    new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'serial',
        port: '/dev/ttyUSB1',
        baudrate: 57600,
        rtscts: true,
      }),
    }),
  );

  expect(response.status).toBe(200);
  expect(savedSettings).toMatchObject({ path: '/dev/ttyUSB1', baudRate: 57600, rtscts: true });
  expect(await response.json()).toMatchObject({ restartRequired: true });
});

test('reports the live transport connection state', async () => {
  const handler = createRequestHandler(new FakeTransport(), {
    transportSettings: {
      type: 'tcp',
      path: 'tcp://localhost:20108',
      baudRate: 57600,
      rtscts: false,
    },
    transportConnected: () => false,
  });

  const response = await handler(new Request('http://localhost/api/settings'));

  expect(await response.json()).toMatchObject({
    type: 'tcp',
    connected: false,
  });
});

test('accepts and returns the Home Assistant log level', async () => {
  const handler = createRequestHandler(new FakeTransport());
  const response = await handler(
    new Request('http://localhost/api/homeassistant', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ log_level: 'debug' }),
    }),
  );

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ log_level: 'debug' });
});
