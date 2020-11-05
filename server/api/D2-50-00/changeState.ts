import { getChecksum } from '../../util/getChecksum'

export function changeState (senderId: number[], receiverId: number[], value: number): Buffer {
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
