const SerialPort = require('serialport')
const port = new SerialPort('COM3', { baudRate: 57600 })
let polycrc = require('polycrc')
let crc8 = polycrc.crc8

const Enocean = require('enocean-js')
const ESP3Parser = Enocean.ESP3Parser
const RadioERP1 = Enocean.RadioERP1

var  radio = RadioERP1.from({rorg:0xd2, payload: [0], id: 'ffe17701' })
radio.payload = radio.encode({ MT: 0, DOMC: 15, OMC: 1, RMT: 0 }, { eep: 'd2-50-00', data: 0 })

console.log(radio.toString());

const usbId = [ 0xff, 0xe7, 0x66, 0x81, ]
const ventId = [ 0x05, 0x12, 0x67, 0x87 ]

console.log(crc8(Buffer.from([

], 'hex')).toString(16))

//  <Buffer 55 00 0d 07 01 fd d4 80 ff 61 00 00 50 d2 05 12 67 87 00 00 ff ff ff ff 2d 00 f7>
//          55 00 0d 07 01 fd d4 80 ff 61 00 00 50 d2 05 0e 0e d1 00 01 ff ff ff ff 36 00 51
//                                                    05 0e 0e d1
//        C 55 00 0d 07 01 fd d4 80 ff 61 00 00 50 d2 05 12 67 87 00 00 ff ff ff ff 2d 00 f7
//        _ 55 00 0d 07 01 fd d4 91 ff 61 00 00 50 d2 ff e7 66 81 00 03 05 12 67 87 ff 00 bc
//       S1 55 00 0d 07 01 fd d4 91 ff 61 00 00 50 d2 ff e7 66 81 00 00 ff ff ff ff 2d 00 f7>
//       S2 55 00 0d 07 01 fd d4 91 ff 61 00 00 50 d2 ff e7 66 81 00 00 05 12 67 87 2d 00 f7>
//      Ref 55 00 0d 07 01 fd d4 91 ff 61 00 00 50 d2 ff e7 66 81 00 03 05 12 67 87 ff 00 bc
//          55 00 0d 07 01 fd d4 91 ff 61 00 00 50 d2 ff e7 66 81 00 03 05 12 67 87 ff 00 f7
//          55 00 07 07 01 7a d2 01 ff e1 77 01 00 03 ff ff ff ff ff 00 90
//          55 00 07 07 01 7a d2 00 ff e7 66 81 00 03 ff ff ff ff ff 00 04


// port.write(teachIn)
var radio = RadioERP1.from({ rorg: 0xd2, payload: [0,0,0,0,0,0], id: 'ffe76681' })
radio.payload = radio.encode({ MT: 0, DOMC: 11 }, { eep: 'd2-50-00', data: 1 })
console.log(radio.toString());

// const arr = []
// radio.toString().split('').reduce((value, v, i) => {
//   value += v
//   if (i % 2 === 1) {
//     arr.push(value)
//     return ''
//   }
//   return value
// }, '')
// console.log(arr)
console.log(Buffer.from(radio.toString(), 'hex'));

port.write(Buffer.from(radio.toString(), 'hex'))

// 0x05,
// 0x12,
// 0x67,
// 0x87,