import { getChecksum } from '../util/getChecksum';
import { toHex } from '../util/toHex';
import type {
  RadioERP1Packet,
  UteCommand,
  UteRequestType,
  UteTeachInInfo,
} from '../devices/inbound';

export interface Esp3Frame {
  packetType: number;
  data: number[];
  optionalData: number[];
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

const uteRequestTypes: UteRequestType[] = ['teachIn', 'teachOut', 'unspecified', 'reserved'];
const uteCommands: UteCommand[] = ['query', 'response'];

export const uteResponseCodes = {
  general: 0,
  teachInAccepted: 1,
  teachOutAccepted: 2,
  eepNotSupported: 3,
} as const;

export type UteResponse = keyof typeof uteResponseCodes;

export function parseUteInfo(payload: number[]): UteTeachInInfo | undefined {
  if (payload.length !== 7) return undefined;
  const control = payload[0];
  const requestType = uteRequestTypes[(control >> 4) & 0x03];
  const command = uteCommands[control & 0x0f] ?? 'reserved';
  const rorg = payload[4];
  const func = payload[5];
  const type = payload[6];
  return {
    control,
    channel: payload[1],
    manufacturer: payload[2] | (payload[3] << 8),
    eep: `${rorg.toString(16).padStart(2, '0')}-${func.toString(16).padStart(2, '0')}-${type.toString(16).padStart(2, '0')}`,
    direction: (control & 0x80) === 0 ? 'unidirectional' : 'bidirectional',
    responseExpected: (control & 0x40) === 0,
    requestType,
    command,
  };
}

function bytesToId(bytes: number[]): string {
  return bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function parseRadioERP1(frame: Esp3Frame): RadioERP1Packet | undefined {
  if (frame.packetType !== 1 || frame.data.length < 6) return undefined;
  const rorg = frame.data[0];
  const payload = frame.data.slice(1, frame.data.length - 5);
  const senderId = bytesToId(frame.data.slice(frame.data.length - 5, frame.data.length - 1));
  const teachInInfo = rorg === 0xd4 ? parseUteInfo(payload) : undefined;
  return {
    RORG: rorg,
    payload,
    senderId,
    teachIn: teachInInfo?.command === 'query' && teachInInfo.requestType === 'teachIn',
    teachInInfo,
  };
}

function responseControl(response: UteResponse): number {
  return 0x80 | (uteResponseCodes[response] << 4) | 0x01;
}

export function buildUteTeachInResponse(
  controllerId: number,
  targetId: number,
  requestPayload: number[],
  response: UteResponse = 'teachInAccepted',
): Buffer {
  if (controllerId === 0 || targetId === 0) {
    throw new Error('UTE controller and target IDs must be non-zero EnOcean identifiers');
  }
  if (requestPayload.length !== 7) {
    throw new Error('UTE request payload must contain exactly seven bytes');
  }
  const payload = [...requestPayload];
  payload[0] = responseControl(response);

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
