import express from 'express'
import { changeState } from './api/D2-50-00/changeState'
import { config } from './config'
import { toHex } from './util/toHex'

import { SerialPort } from 'serialport'
import { Socket } from 'net'
import { isTcpPath, parseTcpPath } from './util'

function getSocketConnection(path: string): Promise<SerialPort | Socket> {
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
    });

    socketPort.on('error', function () {
      console.log('Socket error');
      reject(new Error(`Error while opening socket`));
    });

    socketPort.connect(info.port, info.host);
  });
}

async function initialize() {
  const addonConfig = require("/data/options.json")
  if (!addonConfig || !addonConfig.adapter) {
    throw new Error("Adapter not configured");
  }
  const socket = await getSocketConnection(addonConfig.adapter)

  const app = express()

  app.get('/:room/:device/:value', function (req, res) {
    const { room, device, value } = req.params
    const roomConfig = config.rooms
      .find(r => r.id.toUpperCase() === room.toUpperCase())

    const deviceConfig = roomConfig?.devices
      .find(d => d.key.toUpperCase() === device.toUpperCase())
    if (!deviceConfig) return res.sendStatus(400)
    const { protocol, sourceId, targetId } = deviceConfig

    switch (protocol) {
      case 'D2-50-00': {
        const payload = changeState(toHex(sourceId), toHex(targetId), parseInt(value))
        // @ts-expect-error ignore
        socket.write(payload)
      }
    }

    return res.sendStatus(204)
  })

  app.listen(3000)

}

initialize()
