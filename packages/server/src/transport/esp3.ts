import { getChecksum } from '../util/getChecksum';
import { toHex } from '../util/toHex';
import type { RadioERP1Packet } from '../devices/inbound';

export interface Esp3Frame {
  packetType: number;
  data: number[];
  optionalData: number[];
}

function readBits(bytes: ArrayLike<number>, offset: number, length: number): number {
  let value = 0;
  for (let index = 0; index < length; index += 1) {
    const bitOffset = offset + index;
    const byte = bytes[Math.floor(bitOffset / 8)] ?? 0;
    value = value * 2 + ((byte >> (7 - (bitOffset % 8))) & 1);
  }
  return value;
}

function writeBits(bytes: number[], value: number, offset: number, length: number): void {
  for (let index = 0; index < length; index += 1) {
    const bitOffset = offset + index;
    const byteIndex = Math.floor(bitOffset / 8);
    const mask = 1 << (7 - (bitOffset % 8));
    const bit = (value >> (length - index - 1)) & 1;
    if (bit) bytes[byteIndex] |= mask;
    else bytes[byteIndex] &= ~mask;
  }
}

export class Esp3Parser {
  private buffer: number[] = [];

  push(chunk: ArrayLike<number>): Esp3Frame[] {
    for (let index = 0; index < chunk.length; index += 1) this.buffer.push(chunk[index]);
    const frames: Esp3Frame[] = [];

    while (this.buffer.length >= 6) {
      const syncIndex = this.buffer.indexOf(0x55);
      if (syncIndex === -1) {
        this.buffer = [];
        break;
      }
      if (syncIndex > 0) this.buffer.splice(0, syncIndex);
      if (this.buffer.length < 6) break;

      const header = this.buffer.slice(1, 5);
      if (getChecksum(header) !== this.buffer[5]) {
        this.buffer.shift();
        continue;
      }

      const dataLength = (header[0] << 8) | header[1];
      const optionalLength = header[2];
      const frameLength = 6 + dataLength + optionalLength + 1;
      if (this.buffer.length < frameLength) break;

      const body = this.buffer.slice(6, frameLength - 1);
      if (getChecksum(body) !== this.buffer[frameLength - 1]) {
        this.buffer.shift();
        continue;
      }

      frames.push({
        packetType: header[3],
        data: body.slice(0, dataLength),
        optionalData: body.slice(dataLength),
      });
      this.buffer.splice(0, frameLength);
    }
    return frames;
  }
}

function parseUteInfo(payload: number[]): { eep: { toString(): string } } {
  const rorg = readBits(payload, 48, 8);
  const func = readBits(payload, 40, 8);
  const type = readBits(payload, 32, 8);
  const eep = `${rorg.toString(16).padStart(2, '0')}-${func.toString(16).padStart(2, '0')}-${type.toString(16).padStart(2, '0')}`;
  return { eep: { toString: () => eep } };
}

function bytesToId(bytes: number[]): string {
  return bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function parseRadioERP1(frame: Esp3Frame): RadioERP1Packet | undefined {
  if (frame.packetType !== 1 || frame.data.length < 6) return undefined;
  const rorg = frame.data[0];
  const payload = frame.data.slice(1, frame.data.length - 5);
  const senderId = bytesToId(frame.data.slice(frame.data.length - 5, frame.data.length - 1));
  return {
    RORG: rorg,
    payload,
    senderId,
    teachIn: rorg === 0xd4,
    teachInInfo: rorg === 0xd4 ? parseUteInfo(payload) : undefined,
  };
}

export function buildUteTeachInResponse(
  controllerId: number,
  targetId: number,
  requestPayload: number[],
): Buffer {
  const payload = [...requestPayload];
  while (payload.length < 6) payload.push(0);
  writeBits(payload, 1, 0, 1);
  writeBits(payload, 1, 2, 2);
  writeBits(payload, 1, 4, 4);

  const data = [0xd4, ...payload, ...toHex(controllerId), 0];
  const optionalData = [3, ...toHex(targetId), 0xff, 0];
  const header = [0, data.length, optionalData.length, 1];
  return Buffer.from([
    0x55,
    ...header,
    getChecksum(header),
    ...data,
    ...optionalData,
    getChecksum([data, optionalData]),
  ]);
}
