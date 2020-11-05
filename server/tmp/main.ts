import WebSocket from 'ws'
import { config } from '../config'
import { DirectOperationModeControl } from '../api/D2-50-00/DirectOperationModeControl'
import { getChecksum } from '../util/getChecksum'

import SerialPort from 'serialport'
import Enocean from 'enocean-js'

const port = new SerialPort('COM3', { baudRate: 57600 })
const RadioERP1 = Enocean.RadioERP1

const wss = new WebSocket.Server({
  port: 8000
})

function changeState (senderId, receiverId, value, channel = 0xff) {
  // 55 00 0c 07 01 96 d2 010000000000 ff e7 66 81 00 03 05 12 67 87 ff 00 eb
  const MAGIC_BYTE = 0x55
  const header = [
  // data leangth
    0x00, 0x0c,
    // optional data length
    0x07,
    // mesage type (erp1 telegram)
    0x01
  ]

  const data = [
  // RORG (UTE)
    0xd2,
    value,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00
  ]
  const STATUS_BYTE = 0x00
  const SUB_TEL_NUM = 0x03
  const SECURITY_LEVEL = 0x00

  const payload = Buffer.from([
    MAGIC_BYTE,
    // header
    ...header,
    getChecksum(header),
    // DATA PAYLOAD
    ...data,
    ...senderId,
    STATUS_BYTE,
    // END DATA PAYLOAD
    // OPTIONAL DATA
    SUB_TEL_NUM,
    ...receiverId,
    // rssi
    channel,
    // Security Level
    SECURITY_LEVEL,
    // -- END OPTIONAL DATA
    // Checksum data part
    getChecksum([data, senderId, STATUS_BYTE, SUB_TEL_NUM, receiverId, channel, SECURITY_LEVEL]) // TODO: calc Checksum Data + Optional Data
  ])
  return payload
}

wss.on('connection', function connection (ws) {
  ws.send(JSON.stringify(config))

  ws.on('message', function incoming (raw) {
    const data = JSON.parse(raw)
    console.log(data)
    // console.log()
    const radio = RadioERP1.from({ rorg: 0xd2, payload: [0, 0, 0, 0, 0, 0], id: data.sourceId })
    radio.destinationId = data.targetId
    radio.payload = radio.encode({ MT: 0, DOMC: data.value }, { eep: 'd2-50-00', data: 1 })
    radio.channel = 0x01

    const payload = changeState(toHex(data.sourceId), toHex(data.targetId), data.value)
    console.log(payload)
    port.write(payload)
  })
})

function toHex (value: string | number) {
  if (typeof value === 'string') {
    return value.match(/(..?)/g)!.map(v => parseInt(v, 16))
  }
  return value.toString(16).match(/(..?)/g)!.map(v => parseInt(v, 16))
}
