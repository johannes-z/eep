import express from 'express'
import { changeState } from './api/D2-50-00/changeState'
import { config } from './config'
import { toHex } from './util/toHex'

import { SerialPort } from 'serialport'
import { Socket } from 'net'
import { isTcpPath, parseTcpPath } from './util'
import { Server } from 'http'
import { exit } from 'process'

export function getSocketConnection(path: string): Promise<SerialPort | Socket> {
  if (!isTcpPath(path)) return Promise.resolve(new SerialPort({ path, baudRate: 57600 }))

  const info = parseTcpPath(path);
  const socketPort = new Socket();
  socketPort.setNoDelay(true);
  socketPort.setKeepAlive(true, 15000);

  return new Promise((resolve, reject): void => {
    socketPort.on('connect', function () {
      console.log('Socket connected');
    });

    // eslint-disable-next-line
    socketPort.on('ready', async function () {
      resolve(socketPort);
    });

    socketPort.once('close', () => {
      console.log('Port closed')
      reject(new Error(`Socket connection closed`));
    });

    socketPort.once('end', () => {
      console.log('Socket ended');
      reject(new Error(`Socket connection ended`));
    })

    socketPort.on('error', function () {
      console.log('Socket error');
      reject(new Error(`Error while opening socket`));
    });

    socketPort.connect(info.port, info.host);
  });
}

export async function initialize(addonConfig) {
  if (!addonConfig || !addonConfig.adapter) {
    console.error("Adapter not configured");
    process.exit(1);
  }

  let server: Server;
  let socket: SerialPort | Socket;

  try {
    socket = await getSocketConnection(addonConfig.adapter);

    // Monitor socket for runtime disconnects
    const handleFatalSocketError = (reason: string) => {
      console.error(`Fatal socket issue: ${reason}. Exiting to trigger Watchdog.`);
      process.exit(1);
    };

    if (socket instanceof Socket) {
      socket.on('close', () => handleFatalSocketError('close'));
      socket.on('end', () => handleFatalSocketError('end'));
      socket.on('error', (err) => {
        console.error('Socket runtime error:', err);
        handleFatalSocketError('error');
      });
    }

    const app = express();

    app.get('/:room/:device/:value', function (req, res) {
      const { room, device, value } = req.params;
      console.log('Received request with params:', { room, device, value });

      const roomConfig = config.rooms.find(r => r.id.toUpperCase() === room.toUpperCase());
      const deviceConfig = roomConfig?.devices.find(d => d.key.toUpperCase() === device.toUpperCase());

      if (!deviceConfig) return res.sendStatus(400);

      const { protocol, sourceId, targetId } = deviceConfig;

      switch (protocol) {
        case 'D2-50-00': {
          let state = parseInt(value);
          if (Number.isNaN(state)) {
            switch (value) {
              case 'Auto': state = 11; break;
              case 'Intake': state = 13; break;
              case 'Exhaust': state = 14; break;
              default: state = 11;
            }
          }
          const payload = changeState(toHex(sourceId), toHex(targetId), state);
          console.log('Sending payload:', payload);
          // @ts-expect-error socket is either SerialPort or Socket
          socket.write(payload);
          return res.sendStatus(200);
        }
      }

      return res.sendStatus(204);
    });

    server = app.listen(3000, () => {
      console.log('Addon server listening on port 3000');
    });

  } catch (error) {
    console.error("Initialization error:", error);
    process.exit(1);
  }
}
