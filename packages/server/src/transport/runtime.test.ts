import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import type { DeviceRegistry } from '../devices/registry';
import type { TeachInManager } from '../devices/teachin';
import type { TransportSettings } from '../config';
import { TransportRuntime } from './runtime';

class FakeConnection extends EventEmitter {
  write = mock(() => undefined);
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
