import { Socket } from 'node:net';
import type { TransportSettings } from '../config';
import { isTcpPath, parseTcpPath } from '../util';

export interface TransportConnection {
  write(payload: Uint8Array): boolean | void | Promise<void>;
  on?(event: string, listener: (data: unknown) => void): void;
  close?(): Promise<void> | void;
}

export async function openTransport(settings: TransportSettings): Promise<TransportConnection> {
  if (settings.type === 'none' || !settings.path) {
    return { write: () => undefined };
  }

  const tcp = isTcpPath(settings.path);
  if (settings.type === 'tcp' && !tcp) {
    throw new Error(`Invalid TCP adapter path: ${settings.path}`);
  }
  if (settings.type === 'serial' && tcp) {
    throw new Error('A TCP adapter path requires a TCP transport type');
  }

  if (!tcp) {
    const { SerialPort } = await import('bun-serialport');
    const serialPort = new SerialPort({
      path: settings.path,
      baudRate: settings.baudRate,
      rtscts: settings.rtscts,
      autoOpen: false,
    });
    await serialPort.open();
    return serialPort;
  }

  const info = parseTcpPath(settings.path);
  const socket = new Socket();
  socket.setNoDelay(true);
  socket.setKeepAlive(true, 15000);

  return await new Promise<Socket>((resolve, reject) => {
    let settled = false;
    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      callback();
    };

    socket.once('connect', () => settle(() => resolve(socket)));
    socket.once('close', () =>
      settle(() => reject(new Error('Socket connection closed before it was ready'))),
    );
    socket.once('end', () => settle(() => reject(new Error('Socket ended before it was ready'))));
    socket.once('error', (error) =>
      settle(() =>
        reject(error instanceof Error ? error : new Error('Error while opening socket')),
      ),
    );
    socket.connect(info.port, info.host);
  });
}

export async function closeTransport(connection: TransportConnection): Promise<void> {
  if (typeof connection.close === 'function') {
    await connection.close();
    return;
  }
  if (connection instanceof Socket) connection.destroy();
}
