import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { DeviceRegistry } from '../devices/registry';
import { TeachInManager } from '../devices/teachin';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { a5Profile } from '../profiles';
import { build4bsFrame, Esp3Parser } from './esp3';
import { PacketListener } from './listener';
import { sendDeviceCommand } from '../devices/commands';
import type { TransportSettings } from '../config';
import { TransportRuntime } from './runtime';

class FakeConnection extends EventEmitter {
  write = mock((_payload: Uint8Array) => undefined);
  close = mock(() => {
    this.emit('close');
  });
}

const settings: TransportSettings = {
  type: 'tcp',
  path: 'tcp://localhost:2000',
  baudRate: 57600,
  rtscts: false,
};

function runtime(connection: FakeConnection, connect = async () => new FakeConnection()) {
  return new TransportRuntime(
    connection,
    {} as DeviceRegistry,
    {} as TeachInManager,
    () => undefined,
    undefined,
    connect,
  );
}

test('connection loss publishes status and rejects commands without stopping the server', async () => {
  const connection = new FakeConnection();
  const transport = runtime(connection);
  const changed = mock(() => undefined);
  transport.onStatusChange(changed);
  await transport.start();
  connection.emit('close');
  expect(transport.isConnected).toBe(false);
  expect(changed).toHaveBeenCalledTimes(1);
  expect(() => transport.current.write(new Uint8Array())).toThrow('not connected');
  await transport.stop();
});

test('automatically answers actuator wakes and captures RX/TX without repeating reference-run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-runtime-actuator-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const connection = new FakeConnection();
  const teachIn = new TeachInManager(registry, 0xffe76685);
  const transport = new TransportRuntime(connection, registry, teachIn, () => undefined);
  const listener = new PacketListener();
  transport.onPacket((frame, radio, direction) => listener.capture(frame, radio, direction));
  try {
    const device = await registry.upsert({
      sourceId: 0xffe76685,
      targetId: 0x05010203,
      name: 'Heating',
      profileId: 'A5-20-06',
      capabilities: a5Profile.defaultCapabilities(),
      availability: 'unknown',
    });
    await sendDeviceCommand(connection, registry, device, { setpoint: 23, referenceRun: true });
    await transport.start();
    for (const expectedControl of [0x84, 0x04]) {
      const replied = new Promise<void>((resolve) => {
        const unsubscribe = transport.onPacket((_frame, _radio, direction) => {
          if (direction === 'tx') {
            unsubscribe();
            resolve();
          }
        });
      });
      const wake = build4bsFrame(device.targetId, device.sourceId, [22, 0xaa, 40, 0x68]);
      connection.emit('data', wake);
      connection.emit('data', wake);
      await replied;
      expect(
        new Esp3Parser().push(connection.write.mock.calls.at(-1)![0])[0].data.slice(1, 5),
      ).toEqual([46, 255, expectedControl, 8]);
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
    expect(connection.write).toHaveBeenCalledTimes(2);
    expect(listener.snapshot().packets.filter((packet) => packet.direction === 'tx')).toHaveLength(
      2,
    );
    expect(registry.findBySourceId(device.sourceId)).toMatchObject({
      desiredState: { setpoint: 23, referenceRun: false },
      reportedState: { temperature: 20 },
    });
  } finally {
    await transport.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed replacement preserves the active connection', async () => {
  const connection = new FakeConnection();
  const transport = runtime(connection, async () => {
    throw new Error('Unavailable');
  });
  await transport.start();
  expect(transport.replace(settings)).rejects.toThrow('Unavailable');
  expect(transport.current).toBe(connection);
  expect(connection.close).not.toHaveBeenCalled();
  await transport.stop();
});

test('events from a replaced connection cannot mark its replacement disconnected', async () => {
  const previous = new FakeConnection();
  const replacement = new FakeConnection();
  const transport = runtime(previous, async () => replacement);
  await transport.start();
  await transport.replace(settings);
  previous.emit('error', new Error('Late error'));
  expect(transport.current).toBe(replacement);
  expect(transport.isConnected).toBe(true);
  expect(previous.close).toHaveBeenCalledTimes(1);
  await transport.stop();
});

test('a lost connection reconnects and reports recovery', async () => {
  const connection = new FakeConnection();
  const replacement = new FakeConnection();
  const transport = runtime(connection, async () => replacement);
  await transport.start(settings);
  const recovered = new Promise<void>((resolve) => {
    transport.onStatusChange(() => {
      if (transport.isConnected) resolve();
    });
  });
  connection.emit('end');
  try {
    await recovered;
    expect(transport.current).toBe(replacement);
  } finally {
    await transport.stop();
  }
});
