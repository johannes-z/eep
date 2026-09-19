import { getChecksum } from '../../util/getChecksum';
import { isD2ControlValue } from './fan';

export function changeState(senderId: number[], receiverId: number[], value: number): Buffer {
  if (senderId.length !== 4 || receiverId.length !== 4) {
    throw new Error('D2-50-00 sender and receiver IDs must contain four bytes');
  }
  if (!Number.isInteger(value) || !isD2ControlValue(value)) {
    throw new Error(`Unsupported D2-50-00 control value: ${value}`);
  }

  // 55 00 0c 07 01 96 d2 010000000000 ff e7 66 81 00 03 05 12 67 87 ff 00 eb
  const MAGIC_BYTE = 0x55;
  const header = [
    // data leangth
    0x00, 0x0c,
    // optional data length
    0x07,
    // mesage type (erp1 telegram)
    0x01,
  ];

  const data = [
    // RORG (UTE)
    0xd2,
    value,
    0x00,
    0x00,
    0x00,
    0x00,
    0x00,
  ];
  const STATUS_BYTE = 0x00;
  const SUB_TEL_NUM = 0x03;
  const RSSI = 0xff;
  const SECURITY_LEVEL = 0x00;

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
    getChecksum([data, senderId, STATUS_BYTE, SUB_TEL_NUM, receiverId, RSSI, SECURITY_LEVEL]), // TODO: calc Checksum Data + Optional Data
  ]);
  return payload;
}
