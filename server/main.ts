import express from 'express'
import { changeState } from './api/D2-50-00/changeState'
import { config } from './config'
import { toHex } from './util/toHex'

import SerialPort from 'serialport'
const port = new SerialPort('COM3', { baudRate: 57600 })

const app = express()

console.log(0xfafafa)

app.get('/:room/:device/:value', function (req, res) {
  console.log(req.params)

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
      port.write(payload)
    }
  }

  return res.sendStatus(204)
})

app.listen(3000)
