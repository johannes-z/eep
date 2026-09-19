import { expect, mock, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultMqttSettings } from './mqtt';
import type { TransportSettings } from './config';
import { DeviceRegistry } from './devices/registry';
import { PacketListener } from './transport/listener';

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

  const response = await handler(new Request('http://localhost/ffe76681/0513cefe/Intake'));

  expect(response.status).toBe(200);
  expect(transport.writes).toHaveLength(1);
  expect(transport.writes[0]).toBeInstanceOf(Uint8Array);
  expect(transport.writes[0][6]).toBe(0xd2);
  expect(transport.writes[0][7]).toBe(13);
});

test('uses the controller ID when sending a command to E05', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-e05-command-'));
  const transport = new FakeTransport();
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const handler = createRequestHandler(transport, {
    controllerId: 0xffe76681,
    registry,
  });

  const response = await handler(new Request('http://localhost/ffe76682/05126787/3'));

  expect(response.status).toBe(200);
  expect(Array.from(transport.writes[0].slice(13, 17))).toEqual([0xff, 0xe7, 0x66, 0x81]);
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

  const response = await handler(new Request('http://localhost/ffe76681/0513cefe/Intake'));

  expect(response.status).toBe(400);
  expect(transport.writes).toHaveLength(0);
});

test('rejects unknown devices and unsupported requests', async () => {
  const handler = createRequestHandler(new FakeTransport());

  expect((await handler(new Request('http://localhost/ffe76681/unknown/Auto'))).status).toBe(400);
  expect(
    (await handler(new Request('http://localhost/ffe76681/0513cefe/Auto', { method: 'POST' })))
      .status,
  ).toBe(405);
  expect((await handler(new Request('http://localhost/ffe76681/0513cefe'))).status).toBe(404);
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
    packets: [{ data: 'D2 01 02', optionalData: '03 04', radio: { senderId: 'ffe76681' } }],
  });

  const stop = await handler(new Request('http://localhost/api/listen/stop', { method: 'POST' }));
  expect(await stop.json()).toMatchObject({ active: false });
});

test('rejects device metadata updates', async () => {
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

  expect(response.status).toBe(405);
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
  expect(await response.text()).toContain('eep / EnOcean bridge');
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

test('reads and updates general transport settings', async () => {
  let savedSettings: TransportSettings = {
    type: 'serial',
    adapter: 'zstack',
    path: '/dev/ttyUSB0',
    baudRate: 115200,
    disableLed: false,
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
    adapter: 'zstack',
    port: '/dev/ttyUSB0',
    baudrate: 115200,
    disable_led: false,
    rtscts: false,
    connected: true,
  });

  const response = await handler(
    new Request('http://localhost/api/settings', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        type: 'serial',
        adapter: 'zstack',
        port: '/dev/ttyUSB1',
        baudrate: 57600,
        disable_led: true,
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
      adapter: '',
      path: 'tcp://localhost:20108',
      baudRate: 57600,
      disableLed: false,
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

test('rejects unsupported Home Assistant event settings', async () => {
  const handler = createRequestHandler(new FakeTransport());
  const response = await handler(
    new Request('http://localhost/api/homeassistant', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ experimental_event_entities: true }),
    }),
  );

  expect(response.status).toBe(400);
  expect(await response.json()).toMatchObject({
    error: 'event entities and legacy action sensors are not supported yet',
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
