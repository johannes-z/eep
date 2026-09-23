import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { getChecksum } from '../util/getChecksum';
import { changeState } from '../profiles/D2-50-00/changeState';
import { toHex } from '../util/toHex';
import {
  build4bsTeachInResponse,
  parse4bsTeachIn,
  buildUteTeachInQuery,
  buildUteTeachInResponse,
  readBaseId,
  readVersion,
  Esp3Parser,
  parseRadioERP1,
  parseUteInfo,
  type Esp3Frame,
} from './esp3';
import type { TransportConnection } from './adapters';

function uteFrame(payload: number[], senderId = 0x05010203): Esp3Frame {
  const data = [0xd4, ...payload, ...toHex(senderId), 0];
  const optionalData = [3, ...toHex(0xffe76681), 0xff, 0];
  return { packetType: 1, data, optionalData };
}

test('parses 4BS profile/manufacturer and answers the MVA005 variation 3 query', () => {
  const query = [0x80, 0x30, 0x49, 0x80];
  expect(parse4bsTeachIn(query)).toEqual({
    eep: 'A5-20-06',
    manufacturer: 0x49,
    command: 'query',
    eepSupported: false,
    senderStored: false,
  });
  const frames = new Esp3Parser().push(build4bsTeachInResponse(0xffe76681, 0x05010203, query));
  expect(frames).toHaveLength(1);
  expect(parseRadioERP1(frames[0])).toMatchObject({
    RORG: 0xa5,
    payload: [0x80, 0x30, 0x49, 0xf0],
    senderId: 'ffe76681',
    destinationId: '05010203',
    teachIn: true,
  });
  expect(parse4bsTeachIn(frames[0].data.slice(1, 5))).toMatchObject({
    command: 'response',
    eepSupported: true,
    senderStored: true,
  });
});

test('4BS teach-in rejects malformed/data/response queries and retains all manufacturer bits', () => {
  for (const payload of [
    [0x80, 0x30, 0x49],
    [0x80, 0x30, 256, 0x80],
    [22, 170, 110, 0xe8],
  ]) {
    expect(parse4bsTeachIn(payload)).toBeUndefined();
    expect(() => build4bsTeachInResponse(1, 2, payload)).toThrow();
  }
  expect(parse4bsTeachIn([0x80, 0x37, 0xff, 0x80])?.manufacturer).toBe(0x7ff);
  expect(parse4bsTeachIn([0, 0, 0, 0])?.eep).toBeUndefined();
  expect(() => build4bsTeachInResponse(1, 2, [0, 0, 0, 0])).toThrow();
  expect(() => build4bsTeachInResponse(1, 2, [0x80, 0x30, 0x49, 0xf0])).toThrow();
  const rejected = new Esp3Parser().push(
    build4bsTeachInResponse(1, 2, [0x80, 0x30, 0x49, 0x80], 'eepNotSupported'),
  );
  expect(rejected[0].data[4]).toBe(0x90);
});

test('parses a fragmented ERP1 frame', () => {
  const frame = changeState(toHex(0xffe76681), toHex(0x0513cefe), 13);
  const parser = new Esp3Parser();
  expect(parser.push(frame.subarray(0, 5))).toHaveLength(0);
  const parsed = parser.push(frame.subarray(5));
  const radio = parseRadioERP1(parsed[0]);

  expect(parsed).toHaveLength(1);
  expect(radio).toMatchObject({
    RORG: 0xd2,
    senderId: 'ffe76681',
    payload: [0x2d, 0, 0x7f, 0x7f, 0x7f, 0],
  });
});

test.each([0x20, 0x30, 0x21, 0x32])(
  'preserves RPS status byte %s separately from payload',
  (status) => {
    expect(
      parseRadioERP1({
        packetType: 1,
        data: [0xf6, 0x10, ...toHex(0x05010203), status],
        optionalData: [],
      }),
    ).toMatchObject({
      RORG: 0xf6,
      payload: [0x10],
      senderId: '05010203',
      status,
      teachIn: false,
    });
  },
);

test('builds a successful UTE teach-in response', () => {
  const response = buildUteTeachInResponse(0xffe76681, 0x05010203, [0, 0, 0, 0, 0, 0x50, 0xd2]);
  const parser = new Esp3Parser();
  const parsed = parser.push(response);

  expect(parsed).toHaveLength(1);
  expect(parsed[0].packetType).toBe(1);
  expect(parsed[0].data.slice(0, 8)).toEqual([0xd4, 0x11, 0, 0, 0, 0, 0x50, 0xd2]);
  expect(parsed[0].optionalData.slice(0, 5)).toEqual([3, 0x05, 0x01, 0x02, 0x03]);
});

test('builds a broadcast UTE teach-in query', () => {
  const query = buildUteTeachInQuery(0xffe76681);
  const parser = new Esp3Parser();
  const parsed = parser.push(query);
  const radio = parseRadioERP1(parsed[0]);

  expect(radio).toMatchObject({
    RORG: 0xd4,
    payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
    senderId: 'ffe76681',
    teachIn: true,
  });
  expect(parsed[0].optionalData.slice(0, 5)).toEqual([3, 0xff, 0xff, 0xff, 0xff]);
});

test('reads the USB 300 base ID with CO_RD_IDBASE', async () => {
  let onData: ((data: unknown) => void) | undefined;
  const connection: TransportConnection = {
    on: (_event, listener) => {
      onData = listener;
    },
    off: () => undefined,
    write: (payload) => {
      expect(Array.from(payload)).toEqual([0x55, 0, 1, 0, 5, 0x70, 0x08, 0x38]);
      onData?.(Uint8Array.from([0x55, 0, 5, 1, 2, 0xdb, 0, 0xff, 0xe7, 0x66, 0x80, 0x0a, 0x07]));
    },
  };

  const baseId = await readBaseId(connection);
  expect(baseId).toBe(0xffe76680);
});

test('cleans up base ID listeners when a transport write throws synchronously', async () => {
  const events = new EventEmitter();
  const connection = Object.assign(events, {
    write: () => {
      throw new Error('Disconnected');
    },
  });
  expect(readBaseId(connection)).rejects.toThrow('Disconnected');
  expect(events.listenerCount('data')).toBe(0);
});

test('rejects a one-byte ESP3 error response without waiting for the timeout', async () => {
  const events = new EventEmitter();
  const connection = Object.assign(events, {
    write: () => {
      const header = [0, 1, 0, 2];
      const body = [1];
      events.emit(
        'data',
        Uint8Array.from([0x55, ...header, getChecksum(header), ...body, getChecksum(body)]),
      );
    },
  });
  expect(readBaseId(connection)).rejects.toThrow('rejected base ID request with status 1');
  expect(events.listenerCount('data')).toBe(0);
});

function responseFrame(data: number[]): Uint8Array {
  const header = [0, data.length, 0, 2];
  return Uint8Array.from([0x55, ...header, getChecksum(header), ...data, getChecksum(data)]);
}

test.each(['USB 300', '1234567890abcdef'])(
  'reads dongle version information (%s)',
  async (description) => {
    const events = new EventEmitter();
    const connection = Object.assign(events, {
      write: (payload: Uint8Array) => {
        expect(new Esp3Parser().push(payload)).toEqual([
          { packetType: 5, data: [0x03], optionalData: [] },
        ]);
        events.emit('data', responseFrame([0]));
        events.emit('data', responseFrame([0, 0xff, 0xe7, 0x66, 0x80]));
        const descriptionBytes = Buffer.alloc(16);
        descriptionBytes.write(description, 'ascii');
        const response = responseFrame([
          0,
          2,
          15,
          0,
          1,
          2,
          6,
          0,
          0,
          0xff,
          0x80,
          0,
          1,
          0,
          0,
          0,
          3,
          ...descriptionBytes,
        ]);
        events.emit('data', response.subarray(0, 10));
        events.emit('data', response.subarray(10));
      },
    });
    expect(await readVersion(connection)).toEqual({
      applicationVersion: '2.15.0.1',
      apiVersion: '2.6.0.0',
      chipId: 'ff800001',
      chipVersion: '00000003',
      description,
    });
    expect(events.listenerCount('data')).toBe(0);
  },
);

test('rejects unsupported version queries and cleans up the listener', () => {
  const events = new EventEmitter();
  const connection = Object.assign(events, {
    write: () => {
      events.emit('data', responseFrame([2]));
    },
  });
  expect(readVersion(connection)).rejects.toThrow('rejected version request with status 2');
  expect(events.listenerCount('data')).toBe(0);
});

test('cleans up version listeners when a transport write fails', () => {
  const events = new EventEmitter();
  const connection = Object.assign(events, {
    write: async () => {
      throw new Error('Disconnected');
    },
  });
  expect(readVersion(connection)).rejects.toThrow('Disconnected');
  expect(events.listenerCount('data')).toBe(0);
});

test('times out a silent dongle and removes the version listener', () => {
  const events = new EventEmitter();
  const connection = Object.assign(events, { write: () => undefined });
  expect(readVersion(connection)).rejects.toThrow('Timed out reading dongle version');
  expect(events.listenerCount('data')).toBe(0);
});

test('does not query version information on a disabled transport', async () => {
  expect(
    await readVersion({
      write: () => {
        throw new Error('Disabled');
      },
    }),
  ).toBeUndefined();
});

test('parses a UTE query in wire order', () => {
  const payload = [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2];
  const radio = parseRadioERP1(uteFrame(payload));

  expect(radio).toMatchObject({
    RORG: 0xd4,
    payload,
    senderId: '05010203',
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });
});

test('parses the AEROline UTE query captured during pairing', () => {
  const radio = parseRadioERP1(uteFrame([0x80, 0xff, 0x61, 0, 0, 0x50, 0xd2], 0x05126787));

  expect(radio).toMatchObject({
    RORG: 0xd4,
    senderId: '05126787',
    teachIn: true,
    teachInInfo: {
      manufacturer: 0x0061,
      eep: 'd2-50-00',
    },
  });
});

test('does not classify non-query UTE packets as teach-in', () => {
  const payload = [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2];
  const controls = [0x81, 0x90, 0xa0, 0xb0, 0x8f];

  for (const control of controls) {
    const radio = parseRadioERP1(uteFrame([control, ...payload.slice(1)]));
    expect(radio?.teachIn).toBe(false);
  }
  expect(parseRadioERP1(uteFrame(payload.slice(0, 6)))?.teachIn).toBe(false);
});

test('encodes every UTE response result', () => {
  const requestPayload = [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2];
  const responses = [
    ['general', 0x81],
    ['teachInAccepted', 0x91],
    ['teachOutAccepted', 0xa1],
    ['eepNotSupported', 0xb1],
  ] as const;

  for (const [response, control] of responses) {
    const frame = buildUteTeachInResponse(0xffe76681, 0x05010203, requestPayload, response);
    const parser = new Esp3Parser();
    const parsed = parser.push(frame);
    expect(parsed[0].data.slice(0, 8)).toEqual([0xd4, control, 0xff, 0x0b, 0, 0, 0x50, 0xd2]);
  }
});

test('parses an accepted UTE response result', () => {
  const frame = buildUteTeachInResponse(
    0xffe76681,
    0x05010203,
    [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
  );
  const parsed = new Esp3Parser().push(frame);
  const radio = parseRadioERP1(parsed[0]);

  expect(radio?.teachIn).toBe(false);
  expect(radio?.teachInInfo).toMatchObject({ command: 'response', response: 'teachInAccepted' });
});

test('rejects invalid UTE response inputs', () => {
  expect(() => buildUteTeachInResponse(0, 0x05010203, [0, 0, 0, 0, 0, 0, 0])).toThrow('non-zero');
  expect(() => buildUteTeachInResponse(0xffe76681, 0x05010203, [0, 0, 0, 0, 0, 0])).toThrow(
    'exactly seven bytes',
  );
});

test.each([0x00, 0x40, 0x80, 0xc0])(
  'preserves UTE direction and echoes query metadata (%s)',
  (control) => {
    const request = [control, 3, 0x23, 0xfa, 1, 0, 0xd5];
    const response = buildUteTeachInResponse(0xffe76681, 0x05010203, request);
    const frame = new Esp3Parser().push(response)[0];
    expect(parseRadioERP1(frame)?.destinationId).toBe('05010203');
    expect(frame.data.slice(1, 8)).toEqual([(control & 0x80) | 0x11, ...request.slice(1)]);
    expect(parseUteInfo(request)?.manufacturer).toBe(0x223);
    expect(parseUteInfo(frame.data.slice(1, 8))).toMatchObject({
      command: 'response',
      requestType: 'reserved',
      response: 'teachInAccepted',
      responseExpected: false,
    });
  },
);

test.each([-1, 256, 1.5, Number.NaN])('rejects invalid UTE payload bytes (%s)', (value) => {
  const request = [0x80, 0xff, value, 0, 0, 0x50, 0xd2];
  expect(parseUteInfo(request)).toBeUndefined();
  expect(() => buildUteTeachInResponse(0xffe76681, 0x05010203, request)).toThrow('valid query');
});

test('does not build a UTE response to a response or reserved command', () => {
  for (const control of [0x91, 0x8f]) {
    expect(() =>
      buildUteTeachInResponse(0xffe76681, 0x05010203, [control, 0xff, 0, 0, 0, 0x50, 0xd2]),
    ).toThrow('valid query');
  }
});
