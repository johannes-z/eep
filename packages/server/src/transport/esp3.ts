import { getChecksum } from '../util/getChecksum';
import { toHex } from '../util/toHex';
import type {
  FourBsTeachInInfo,
  RadioERP1Packet,
  UteCommand,
  UteRequestType,
  UteResponseResult,
  UteTeachInInfo,
} from '../devices/inbound';
import type { TransportConnection } from './adapters';

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

export function buildCommonCommand(command: number): Buffer {
  if (!Number.isInteger(command) || command < 0 || command > 0xff) {
    throw new Error('ESP3 common command must be a byte');
  }
  const header = [0, 1, 0, 5];
  const data = [command];
  return Buffer.from([0x55, ...header, getChecksum(header), ...data, getChecksum(data)]);
}

export interface DongleVersion {
  applicationVersion: string;
  apiVersion: string;
  chipId: string;
  chipVersion: string;
  description: string;
}

async function readCommonCommand(
  connection: TransportConnection,
  command: number,
  responseLength: number,
  label: string,
): Promise<Esp3Frame | undefined> {
  if (!connection.on) return undefined;
  const parser = new Esp3Parser();
  return new Promise<Esp3Frame>((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout>;
    const finish = (error?: Error, value?: Esp3Frame): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      connection.off?.('data', onData);
      if (error) reject(error);
      else resolve(value as Esp3Frame);
    };
    const onData = (chunk: unknown): void => {
      if (!chunk || typeof chunk !== 'object' || !('length' in chunk)) return;
      for (const frame of parser.push(chunk as ArrayLike<number>)) {
        if (frame.packetType !== 2 || frame.data.length === 0) continue;
        if (frame.data[0] !== 0) {
          finish(new Error(`Dongle rejected ${label} request with status ${frame.data[0]}`));
          return;
        }
        if (frame.data.length !== responseLength) continue;
        finish(undefined, frame);
        return;
      }
    };
    timer = setTimeout(() => finish(new Error(`Timed out reading dongle ${label}`)), 3000);
    connection.on?.('data', onData);
    void Promise.resolve()
      .then(() => connection.write(buildCommonCommand(command)))
      .catch((error: unknown) =>
        finish(error instanceof Error ? error : new Error(`Failed to read dongle ${label}`)),
      );
  });
}

export async function readBaseId(connection: TransportConnection): Promise<number | undefined> {
  const frame = await readCommonCommand(connection, 0x08, 5, 'base ID');
  if (!frame) return undefined;
  const baseId =
    (frame.data[1] << 24) | (frame.data[2] << 16) | (frame.data[3] << 8) | frame.data[4];
  return baseId >>> 0;
}

export async function readVersion(
  connection: TransportConnection,
): Promise<DongleVersion | undefined> {
  const frame = await readCommonCommand(connection, 0x03, 33, 'version');
  if (!frame) return undefined;
  const descriptionBytes = frame.data.slice(17, 33);
  const terminator = descriptionBytes.indexOf(0);
  return {
    applicationVersion: frame.data.slice(1, 5).join('.'),
    apiVersion: frame.data.slice(5, 9).join('.'),
    chipId: bytesToId(frame.data.slice(9, 13)),
    chipVersion: bytesToId(frame.data.slice(13, 17)),
    description: Buffer.from(
      terminator === -1 ? descriptionBytes : descriptionBytes.slice(0, terminator),
    )
      .toString('ascii')
      .trim(),
  };
}

const uteRequestTypes: UteRequestType[] = ['teachIn', 'teachOut', 'unspecified', 'reserved'];
const uteCommands: UteCommand[] = ['query', 'response'];
const uteResponseResults: UteResponseResult[] = [
  'general',
  'teachInAccepted',
  'teachOutAccepted',
  'eepNotSupported',
];

export const uteResponseCodes = {
  general: 0,
  teachInAccepted: 1,
  teachOutAccepted: 2,
  eepNotSupported: 3,
} as const;

export type UteResponse = keyof typeof uteResponseCodes;

export function parseUteInfo(payload: number[]): UteTeachInInfo | undefined {
  if (
    payload.length !== 7 ||
    payload.some((value) => !Number.isInteger(value) || value < 0 || value > 0xff)
  )
    return undefined;
  const control = payload[0];
  const command = uteCommands[control & 0x0f] ?? 'reserved';
  const requestType = command === 'query' ? uteRequestTypes[(control >> 4) & 0x03] : 'reserved';
  const type = payload[4];
  const func = payload[5];
  const rorg = payload[6];
  const response = command === 'response' ? uteResponseResults[(control >> 4) & 0x03] : undefined;
  return {
    control,
    channel: payload[1],
    manufacturer: payload[2] | ((payload[3] & 0x07) << 8),
    eep: `${rorg.toString(16).padStart(2, '0')}-${func.toString(16).padStart(2, '0')}-${type.toString(16).padStart(2, '0')}`,
    direction: (control & 0x80) === 0 ? 'unidirectional' : 'bidirectional',
    responseExpected: command === 'query' && (control & 0x40) === 0,
    requestType,
    command,
    ...(response ? { response } : {}),
  };
}

function bytesToId(bytes: number[]): string {
  return bytes.map((value) => value.toString(16).padStart(2, '0')).join('');
}

export function parse4bsTeachIn(payload: ArrayLike<number>): FourBsTeachInInfo | undefined {
  if (
    payload.length !== 4 ||
    Array.from(payload).some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff) ||
    (payload[3] & 0x08) !== 0
  )
    return undefined;
  const hasProfile = (payload[3] & 0x80) !== 0;
  const func = payload[0] >> 2;
  const type = ((payload[0] & 0x03) << 5) | (payload[1] >> 3);
  return {
    eep: hasProfile
      ? `A5-${func.toString(16).padStart(2, '0')}-${type.toString(16).padStart(2, '0')}`.toUpperCase()
      : undefined,
    manufacturer: hasProfile ? ((payload[1] & 0x07) << 8) | payload[2] : undefined,
    command: (payload[3] & 0x10) === 0 ? ('query' as const) : ('response' as const),
    eepSupported: (payload[3] & 0x40) !== 0,
    senderStored: (payload[3] & 0x20) !== 0,
  };
}

export function parseRadioERP1(frame: Esp3Frame): RadioERP1Packet | undefined {
  if (frame.packetType !== 1 || frame.data.length < 6) return undefined;
  const rorg = frame.data[0];
  const payload = frame.data.slice(1, frame.data.length - 5);
  const senderId = bytesToId(frame.data.slice(frame.data.length - 5, frame.data.length - 1));
  const teachInInfo = rorg === 0xd4 ? parseUteInfo(payload) : undefined;
  const fourBsTeachInInfo = rorg === 0xa5 ? parse4bsTeachIn(payload) : undefined;
  return {
    RORG: rorg,
    payload,
    senderId,
    status: frame.data[frame.data.length - 1],
    ...(frame.optionalData.length >= 5
      ? { destinationId: bytesToId(frame.optionalData.slice(1, 5)) }
      : {}),
    teachIn:
      (rorg === 0xd5 && payload.length === 1 && (payload[0] & 0x08) === 0) ||
      fourBsTeachInInfo !== undefined ||
      (teachInInfo?.command === 'query' && teachInInfo.requestType === 'teachIn'),
    teachInInfo: teachInInfo ?? fourBsTeachInInfo,
  };
}

function responseControl(response: UteResponse, requestControl: number): number {
  if (!Object.hasOwn(uteResponseCodes, response)) throw new Error('Invalid UTE response result');
  return (requestControl & 0x80) | (uteResponseCodes[response] << 4) | 0x01;
}

function validateIdentifier(value: number, field: string): void {
  if (!Number.isInteger(value) || value < 1 || value > 0xffffffff) {
    throw new Error(`UTE ${field} ID must be a non-zero EnOcean identifier`);
  }
}

function buildRadioFrame(
  rorg: number,
  senderId: number,
  targetId: number,
  payload: number[],
): Buffer {
  validateIdentifier(senderId, 'controller');
  if (!Number.isInteger(targetId) || targetId < 0 || targetId > 0xffffffff) {
    throw new Error('UTE target ID must be an EnOcean identifier');
  }
  const data = [rorg, ...payload, ...toHex(senderId), 0];
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

export function build4bsFrame(senderId: number, targetId: number, payload: number[]): Buffer {
  if (
    payload.length !== 4 ||
    payload.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 0xff)
  ) {
    throw new Error('4BS payload must contain exactly four bytes');
  }
  return buildRadioFrame(0xa5, senderId, targetId, payload);
}

export function build4bsTeachInResponse(
  controllerId: number,
  targetId: number,
  requestPayload: number[],
  response: UteResponse = 'teachInAccepted',
): Buffer {
  const info = parse4bsTeachIn(requestPayload);
  if (!info?.eep || info.command !== 'query') {
    throw new Error('4BS response requires a query with EEP and manufacturer');
  }
  if (!Object.hasOwn(uteResponseCodes, response)) throw new Error('Invalid 4BS response result');
  validateIdentifier(targetId, 'target');
  const control =
    response === 'teachInAccepted' ? 0xf0 : response === 'eepNotSupported' ? 0x90 : 0xd0;
  return build4bsFrame(controllerId, targetId, [...requestPayload.slice(0, 3), control]);
}

export function buildUteTeachInQuery(
  controllerId: number,
  targetId = 0xffffffff,
  options: { channel?: number; manufacturerId?: number; eep?: string } = {},
): Buffer {
  const channel = options.channel ?? 0xff;
  const manufacturerId = options.manufacturerId ?? 0x000b;
  const eep = options.eep ?? 'D2-50-00';
  const match = /^(?:0x)?([0-9a-f]{2})-([0-9a-f]{2})-([0-9a-f]{2})$/i.exec(eep);
  if (!match) throw new Error(`Invalid UTE EEP: ${eep}`);
  if (!Number.isInteger(channel) || channel < 0 || channel > 0xff) {
    throw new Error('UTE channel must be a byte');
  }
  if (!Number.isInteger(manufacturerId) || manufacturerId < 0 || manufacturerId > 0x7ff) {
    throw new Error('UTE manufacturer ID must be an 11-bit value');
  }
  return buildRadioFrame(0xd4, controllerId, targetId, [
    0x80,
    channel,
    manufacturerId & 0xff,
    manufacturerId >> 8,
    Number.parseInt(match[3], 16),
    Number.parseInt(match[2], 16),
    Number.parseInt(match[1], 16),
  ]);
}

export function buildUteTeachInResponse(
  controllerId: number,
  targetId: number,
  requestPayload: number[],
  response: UteResponse = 'teachInAccepted',
): Buffer {
  validateIdentifier(controllerId, 'controller');
  validateIdentifier(targetId, 'target');
  if (requestPayload.length !== 7) {
    throw new Error('UTE request payload must contain exactly seven bytes');
  }
  if (parseUteInfo(requestPayload)?.command !== 'query') {
    throw new Error('UTE response requires a valid query payload');
  }
  const payload = [...requestPayload];
  payload[0] = responseControl(response, requestPayload[0]);

  return buildRadioFrame(0xd4, controllerId, targetId, payload);
}
