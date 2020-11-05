import SerialPort from 'serialport'
import { getChecksum } from '../../util/getChecksum'

const port = new SerialPort('COM3', { baudRate: 57600 })

const senderId = [
  0xff,
  0xe7,
  0x66,
  0x84
]
const receiverId = [
  0x05,
  0x13,
  0xcd,
  0xf8
]

function sendPackage (senderId: number[], receiverId: number[] = [0xff, 0xff, 0xff, 0xff]) {
  const MAGIC_BYTE = 0x55
  const header = [
  // data leangth
    0x00, 0x0d,
    // optional data length
    0x07,
    // mesage type (erp1 telegram)
    0x01
  ]
  const EEP_PROFILE = [
    0x00, // TYPE
    0x50, // FUNC
    0xd2 // RORG
  ]

  const data = [
  // RORG (UTE)
    0xd4,
    // bidirectional | Accept Request | UTE message type
    0b10010001,
    // Number of channels. ff = all channels
    0xff,
    // LSB of manufacturer id
    0x61,
    0x00,
    ...EEP_PROFILE
  ]
  const STATUS_BYTE = 0x00
  const SUB_TEL_NUM = 0x03
  const RSSI = 0xff
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
    RSSI,
    // Security Level
    SECURITY_LEVEL,
    // -- END OPTIONAL DATA
    // Checksum data part
    getChecksum([data, senderId, STATUS_BYTE, SUB_TEL_NUM, receiverId, RSSI, SECURITY_LEVEL]) // TODO: calc Checksum Data + Optional Data
  ])
  return payload
}

let done = false
port.on('data', function (_data) {
  if (done) return
  console.log('Data:', _data)
  const teachIn = sendPackage(senderId, receiverId)
  port.write(teachIn)
  done = true
})

// port.write(teachIn)
