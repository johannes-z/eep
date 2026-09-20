import { useEffect, useEffectEvent, useState } from 'react';
import type { AppSnapshot } from './types';

export function useLiveSnapshot(onSnapshot: (snapshot: AppSnapshot) => void) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting');
  const receiveSnapshot = useEffectEvent(onSnapshot);

  useEffect(() => {
    let stopped = false;
    let socket: WebSocket;
    let retryTimer: number | undefined;
    let retryDelay = 500;
    const url = new URL('/api/events', window.location.href);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    function connect() {
      socket = new WebSocket(url);
      socket.onmessage = (event) => {
        if (stopped) return;
        try {
          const message = JSON.parse(String(event.data)) as { type: string; state: AppSnapshot };
          if (message.type !== 'snapshot') return;
          receiveSnapshot(message.state);
          retryDelay = 500;
          setStatus('connected');
        } catch {
          socket.close();
        }
      };
      socket.onerror = () => socket.close();
      socket.onclose = () => {
        if (stopped) return;
        setStatus('disconnected');
        retryTimer = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(retryDelay * 2, 10000);
      };
    }

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retryTimer);
      socket.close();
    };
  }, []);

  return status;
}
