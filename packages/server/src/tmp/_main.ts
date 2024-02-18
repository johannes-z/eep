import SerialPort from 'serialport'

import Enocean from 'enocean-js'
const port = new SerialPort('COM3', { baudRate: 123 })
const polycrc = require('polycrc')
const crc8 = polycrc.crc8
const ESP3Parser = Enocean.ESP3Parser
const RadioERP1 = Enocean.RadioERP1

enum DirectOperationModeControl {
  Off = 0,
  Level1 = 1,
  Level2 = 2,
  Level3 = 3,
  Level4 = 4,
  Automatic = 11,
  SupplyOnly = 13,
  ExhaustOnly = 14,
}

const usbId = [0xff, 0xe7, 0x66, 0x81]
const ventId = [0x05, 0x12, 0x67, 0x87]

const radio = RadioERP1.from({ rorg: 0xd2, payload: [0, 0, 0, 0, 0, 0], id: 'ffe76681' })
radio.destinationId = '05126787'
radio.payload = radio.encode({ MT: 0, DOMC: DirectOperationModeControl.Level3 }, { eep: 'd2-50-00', data: 1 })
// MP      opt. data
// || |len| ||    CS                      |-source--|       |-target--|       CS
// 55 00 0c 07 01 96 d2 01 00 00 00 00 00 ff e7 66 81 00 03 05 12 67 87 ff 00 eb

console.log(radio.toString())

port.write(Buffer.from(radio.toString(), 'hex'))

// 0x05,
// 0x12,
// 0x67,
// 0x87,
