import { getChecksum } from '../../util/getChecksum';
import { isD2ControlValue } from './fan';

export function changeState(senderBytes: number[], receiverBytes: number[], value: number): Buffer {
  if (senderBytes.length !== 4 || receiverBytes.length !== 4) {
    throw new Error('D2-50-00 sender and receiver IDs must contain four bytes');
  }
  if (
    [...senderBytes, ...receiverBytes].some(
      (byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff,
    )
  ) {
    throw new Error('D2-50-00 identifiers must contain valid bytes');
  }
  if (!Number.isInteger(value) || !isD2ControlValue(value)) {
    throw new Error(`Unsupported D2-50-00 control value: ${value}`);
  }

  const header = [0x00, 0x0c, 0x07, 0x01];
  const data = [0xd2, 0x20 | value, 0x00, 0x7f, 0x7f, 0x7f, 0x00];
  const statusByte = 0x00;
  const subTelNum = 0x03;
  const rssi = 0xff;
  const securityLevel = 0x00;

  return Buffer.from([
    0x55,
    ...header,
    getChecksum(header),
    ...data,
    ...senderBytes,
    statusByte,
    subTelNum,
    ...receiverBytes,
    rssi,
    securityLevel,
    getChecksum([data, senderBytes, statusByte, subTelNum, receiverBytes, rssi, securityLevel]),
  ]);
}
