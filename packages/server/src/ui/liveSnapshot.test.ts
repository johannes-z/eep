import { expect, test } from 'bun:test';
import { createLiveSnapshotStore } from './liveSnapshot';

test('shares one connection and returns stable snapshots until a message arrives', () => {
  let opened = 0;
  let closed = 0;
  const socket = {
    close: () => {
      closed += 1;
    },
    onmessage: null,
    onerror: null,
    onclose: null,
  } as unknown as WebSocket;
  const store = createLiveSnapshotStore(() => {
    opened += 1;
    return socket;
  });
  const unsubscribe = store.subscribe(() => undefined);
  const unsubscribeSecond = store.subscribe(() => undefined);
  expect(opened).toBe(1);
  expect(store.getSnapshot()).toBe(store.getSnapshot());
  socket.onmessage?.call(
    socket,
    new MessageEvent('message', {
      data: JSON.stringify({ type: 'snapshot', state: { devices: [] } }),
    }),
  );
  const received = store.getSnapshot();
  expect(received.status).toBe('connected');
  unsubscribe();
  expect(closed).toBe(0);
  unsubscribeSecond();
  expect(closed).toBe(1);
  expect(socket.onmessage).toBeNull();
  expect(store.getSnapshot()).toBe(received);
  const unsubscribeAgain = store.subscribe(() => undefined);
  expect(opened).toBe(2);
  expect(store.getSnapshot().status).toBe('connecting');
  unsubscribeAgain();
});

test('retains state after disconnect and cancels reconnect on unsubscribe', () => {
  const socket = { close: () => undefined } as unknown as WebSocket;
  const store = createLiveSnapshotStore(() => socket);
  const unsubscribe = store.subscribe(() => undefined);
  socket.onmessage?.call(
    socket,
    new MessageEvent('message', {
      data: JSON.stringify({ type: 'snapshot', state: { devices: [] } }),
    }),
  );
  const snapshot = store.getSnapshot().snapshot;
  socket.onclose?.call(socket, new CloseEvent('close'));
  expect(store.getSnapshot()).toEqual({ snapshot, status: 'disconnected' });
  unsubscribe();
});
