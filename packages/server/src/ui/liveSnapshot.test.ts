import { expect, spyOn, test } from 'bun:test';
import { QueryClient } from '@tanstack/react-query';
import { cacheLiveSnapshot, snapshotQueryOptions } from './api';
import { createLiveSnapshotStore } from './liveSnapshot';
import type { AppSnapshot } from './types';

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

test('loads the snapshot from GET endpoints through the query cache', async () => {
  const resources = {
    devices: [],
    general: { start_id: '00000001' },
    settings: { type: 'none' },
    homeassistant: { enabled: false },
    mqtt: { configured: false },
    pairing: { active: false, candidates: [], ignoredDevices: [] },
    listen: { active: false, packets: [] },
  };
  const fetchMock = spyOn(globalThis, 'fetch').mockImplementation(
    Object.assign(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe('GET');
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        if (typeof input !== 'string') throw new Error('Expected an API path');
        const resource = input.slice('/api/'.length) as keyof typeof resources;
        expect(resource in resources).toBe(true);
        return Response.json(resources[resource]);
      },
      { preconnect: fetch.preconnect },
    ),
  );
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    const snapshot = await queryClient.fetchQuery(snapshotQueryOptions);
    expect(snapshot).toEqual<unknown>({
      devices: resources.devices,
      general: resources.general,
      transport: resources.settings,
      homeAssistant: resources.homeassistant,
      mqtt: resources.mqtt,
      pairing: resources.pairing,
      listen: resources.listen,
    });
    expect(queryClient.getQueryData(snapshotQueryOptions.queryKey)).toEqual<
      AppSnapshot | undefined
    >(snapshot);
    expect(fetchMock).toHaveBeenCalledTimes(7);
  } finally {
    fetchMock.mockRestore();
    queryClient.clear();
  }
});

test('a live snapshot cancels older GETs and cannot be overwritten by their results', async () => {
  const queryClient = new QueryClient();
  const older = { devices: [] } as unknown as AppSnapshot;
  const latest = { devices: [{ name: 'Updated device' }] } as unknown as AppSnapshot;
  let finishRequest!: (snapshot: AppSnapshot) => void;
  let aborted = false;
  const pending = queryClient
    .fetchQuery({
      ...snapshotQueryOptions,
      queryFn: ({ signal }) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return new Promise<AppSnapshot>((resolve) => {
          finishRequest = resolve;
        });
      },
    })
    .catch((reason: unknown) => reason);
  const socket = { close: () => undefined } as unknown as WebSocket;
  const store = createLiveSnapshotStore(
    () => socket,
    (snapshot) => cacheLiveSnapshot(queryClient, snapshot),
  );
  const unsubscribe = store.subscribe(() => undefined);
  try {
    socket.onmessage?.call(
      socket,
      new MessageEvent('message', {
        data: JSON.stringify({ type: 'snapshot', state: latest }),
      }),
    );
    finishRequest(older);
    expect(await pending).toEqual(latest);
    expect(aborted).toBe(true);
    expect(queryClient.getQueryData(snapshotQueryOptions.queryKey)).toEqual<
      AppSnapshot | undefined
    >(latest);
    expect(store.getSnapshot().status).toBe('connected');
  } finally {
    unsubscribe();
    queryClient.clear();
  }
});
