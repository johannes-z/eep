const polycrc = require('polycrc');
const crc8 = polycrc.crc8;

export function getChecksum(payload: any[]) {
  return crc8(Buffer.from(payload.flat(Infinity)));
}
