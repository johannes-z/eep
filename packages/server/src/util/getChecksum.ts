const { crc8 } = require('polycrc') as { crc8: (payload: Uint8Array) => number };

export function getChecksum(payload: ReadonlyArray<number | readonly number[]>): number {
  return crc8(Buffer.from(payload.flat()));
}
