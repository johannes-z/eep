import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, useSyncExternalStore } from 'react';
import { cacheLiveSnapshot, snapshotQueryOptions } from './api';
import type { AppSnapshot } from './types';

interface LiveState {
  snapshot: AppSnapshot | null;
  status: 'connecting' | 'connected' | 'disconnected';
}

const initialState: LiveState = { snapshot: null, status: 'connecting' };

export function createLiveSnapshotStore(
  openSocket: () => WebSocket,
  onSnapshot: (snapshot: AppSnapshot) => void = () => undefined,
) {
  let state = initialState;
  const listeners = new Set<() => void>();
  let disconnect: (() => void) | undefined;

  function publish(next: LiveState) {
    state = next;
    for (const listener of listeners) listener();
  }

  function start() {
    let stopped = false;
    let socket: WebSocket | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let retryDelay = 500;

    function retry() {
      if (stopped) return;
      publish({ ...state, status: 'disconnected' });
      retryTimer = setTimeout(connect, retryDelay);
      retryDelay = Math.min(retryDelay * 2, 10000);
    }

    function connect() {
      if (stopped) return;
      try {
        socket = openSocket();
      } catch {
        retry();
        return;
      }
      const current = socket;
      current.onmessage = (event) => {
        if (stopped || current !== socket) return;
        try {
          const message = JSON.parse(String(event.data)) as { type: string; state: AppSnapshot };
          if (message.type !== 'snapshot') return;
          if (!message.state || !Array.isArray(message.state.devices)) {
            throw new Error('Invalid snapshot');
          }
          retryDelay = 500;
          onSnapshot(message.state);
          publish({ snapshot: message.state, status: 'connected' });
        } catch {
          current.close();
        }
      };
      current.onerror = () => current.close();
      current.onclose = retry;
    }

    publish({ ...state, status: 'connecting' });
    connect();
    return () => {
      stopped = true;
      clearTimeout(retryTimer);
      if (socket) {
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
        socket.close();
      }
    };
  }

  return {
    getSnapshot: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      if (listeners.size === 1) disconnect = start();
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
          disconnect?.();
          disconnect = undefined;
        }
      };
    },
  };
}

export function useLiveSnapshot() {
  const queryClient = useQueryClient();
  const query = useQuery(snapshotQueryOptions);
  const [liveStore] = useState(() =>
    createLiveSnapshotStore(
      () => {
        const url = new URL('/api/events', window.location.href);
        url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
        return new WebSocket(url);
      },
      (snapshot) => cacheLiveSnapshot(queryClient, snapshot),
    ),
  );
  const { status } = useSyncExternalStore(
    liveStore.subscribe,
    liveStore.getSnapshot,
    () => initialState,
  );
  return { snapshot: query.data ?? null, status, error: query.error };
}
