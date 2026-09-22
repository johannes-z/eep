import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from '../devices/registry';
import { TeachInManager } from '../devices/teachin';
import { PacketListener } from '../transport/listener';
import type { AppSnapshot } from '../ui/types';
import { createRequestHandler } from './requestHandler';
import { createStateUpdates } from './stateUpdates';

function nextMessage(client: WebSocket): Promise<unknown> {
  return new Promise((resolve, reject) => {
    client.addEventListener('message', (event) => resolve(JSON.parse(String(event.data))), {
      once: true,
    });
    client.addEventListener('error', () => reject(new Error('WebSocket failed')), { once: true });
  });
}

test('websocket sends initial state, broadcasts changes, and resynchronizes reconnects', async () => {
  let value = 1;
  const updates = createStateUpdates(() => ({ value }));
  const server = Bun.serve<undefined>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return new Response(null, { status: 400 });
    },
    websocket: updates.websocket,
  });
  const clients: WebSocket[] = [];
  const connect = () => {
    const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
    clients.push(client);
    return client;
  };
  try {
    const first = connect();
    expect(await nextMessage(first)).toEqual({ type: 'snapshot', state: { value: 1 } });
    const second = connect();
    expect(await nextMessage(second)).toEqual({ type: 'snapshot', state: { value: 1 } });
    const messages = Promise.all([nextMessage(first), nextMessage(second)]);
    value = 2;
    updates.notify();
    updates.notify();
    expect(await messages).toEqual([
      { type: 'snapshot', state: { value: 2 } },
      { type: 'snapshot', state: { value: 2 } },
    ]);
    first.close();
    value = 3;
    const reconnected = connect();
    expect(await nextMessage(reconnected)).toEqual({ type: 'snapshot', state: { value: 3 } });
  } finally {
    updates.dispose();
    for (const client of clients) client.close();
    await server.stop(true);
  }
});

test('pushes API snapshots for device, settings, pairing, and packet changes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-websocket-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const teachIn = new TeachInManager(registry, 0xffe76685);
  const listener = new PacketListener();
  const handler = createRequestHandler(() => ({ write() {} }), {
    registry,
    teachIn,
    listener,
    onChange: () => updates.notify(),
  });
  const updates = createStateUpdates(handler.snapshot);
  const unsubscribe = [
    registry.onChange(updates.notify),
    registry.onRemove(updates.notify),
    teachIn.onChange(updates.notify),
    listener.onChange(updates.notify),
  ];
  const server = Bun.serve<undefined>({
    port: 0,
    hostname: '127.0.0.1',
    fetch(request, server) {
      if (server.upgrade(request)) return;
      return handler(request);
    },
    websocket: updates.websocket,
  });
  const client = new WebSocket(`ws://127.0.0.1:${server.port}/api/events`);
  function nextState(predicate: (state: AppSnapshot) => boolean): Promise<AppSnapshot> {
    return new Promise((resolve) => {
      function receive(event: MessageEvent) {
        const { state } = JSON.parse(String(event.data)) as { state: AppSnapshot };
        if (!predicate(state)) return;
        client.removeEventListener('message', receive);
        resolve(state);
      }
      client.addEventListener('message', receive);
    });
  }
  try {
    const initial = await nextState(() => true);
    for (const [key, path] of Object.entries({
      devices: 'devices',
      general: 'general',
      transport: 'settings',
      mqtt: 'mqtt',
      homeAssistant: 'homeassistant',
      pairing: 'pairing',
      listen: 'listen',
    })) {
      const response = await handler(new Request(`http://localhost/api/${path}`));
      expect(initial[key as keyof AppSnapshot]).toEqual(await response.json());
    }

    const renamed = nextState((state) => state.devices.some((device) => device.name === 'Renamed'));
    await registry.update(0xffe76681, { name: 'Renamed' });
    await renamed;

    const removed = nextState(
      (state) => !state.devices.some((device) => device.sourceId === 0xffe76681),
    );
    await registry.remove(0xffe76681);
    await removed;

    const configured = nextState((state) => state.general.start_id === 'ffe76685');
    await handler(
      new Request('http://localhost/api/general', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ start_id: 'ffe76685' }),
      }),
    );
    await configured;

    const passive = nextState(
      (state) =>
        !state.pairing.active &&
        state.pairing.candidates.some((item) => item.targetId === 0x05010204),
    );
    teachIn.observe({ RORG: 0xf6, senderId: '05010204', payload: [0x10], status: 0x30 });
    await passive;
    const dismissed = nextState((state) => state.pairing.candidates.length === 0);
    teachIn.reject(0x05010204);
    await dismissed;

    const pairing = nextState((state) => state.pairing.active);
    teachIn.start();
    await pairing;
    const candidate = nextState((state) => state.pairing.candidates.length === 1);
    teachIn.observe({
      RORG: 0xd4,
      senderId: '05010203',
      payload: [0x40, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
      teachIn: true,
      teachInInfo: {
        control: 0x80,
        channel: 0xff,
        manufacturer: 0x000b,
        eep: 'd2-50-00',
        direction: 'bidirectional',
        responseExpected: true,
        requestType: 'teachIn',
        command: 'query',
      },
    });
    await candidate;
    const accepted = nextState(
      (state) =>
        state.pairing.candidates.length === 0 &&
        state.devices.some((device) => device.targetId === 0x05010203),
    );
    await teachIn.accept(0x05010203);
    await accepted;

    const listening = nextState((state) => state.listen.active);
    listener.start();
    await listening;
    const captured = nextState((state) => state.listen.packets.length === 2);
    const frame = { packetType: 2, data: [0], optionalData: [] };
    listener.capture(frame);
    listener.capture(frame, undefined, 'tx');
    expect((await captured).listen.packets.map((packet) => packet.direction)).toEqual(['rx', 'tx']);
    const stopped = nextState((state) => !state.listen.active && !state.pairing.active);
    listener.stop();
    teachIn.stop();
    await stopped;
  } finally {
    for (const dispose of unsubscribe) dispose();
    updates.dispose();
    client.close();
    await server.stop(true);
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});
