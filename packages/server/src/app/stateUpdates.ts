import type { ServerWebSocket, WebSocketHandler } from 'bun';

export function createStateUpdates(snapshot: () => unknown) {
  const clients = new Set<ServerWebSocket<undefined>>();
  let scheduled = false;
  let disposed = false;

  function notify(): void {
    if (scheduled || disposed || clients.size === 0) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed || clients.size === 0) return;
      const message = JSON.stringify({ type: 'snapshot', state: snapshot() });
      for (const client of clients) client.send(message);
    });
  }

  const websocket: WebSocketHandler<undefined> = {
    open(client) {
      clients.add(client);
      client.send(JSON.stringify({ type: 'snapshot', state: snapshot() }));
    },
    message() {},
    close(client) {
      clients.delete(client);
    },
    closeOnBackpressureLimit: true,
    idleTimeout: 120,
    sendPings: true,
  };

  function dispose(): void {
    disposed = true;
    for (const client of clients) client.close(1001, 'Server shutting down');
    clients.clear();
  }

  return { websocket, notify, dispose };
}
