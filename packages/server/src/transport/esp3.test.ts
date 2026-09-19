import { expect, test } from 'bun:test';
import { changeState } from '../api/D2-50-00/changeState';
import { toHex } from '../util/toHex';
import {
  buildUteTeachInQuery,
  buildUteTeachInResponse,
  Esp3Parser,
  parseRadioERP1,
  type Esp3Frame,
} from './esp3';

function uteFrame(payload: number[], senderId = 0x05010203): Esp3Frame {
  const data = [0xd4, ...payload, ...toHex(senderId), 0];
  const optionalData = [3, ...toHex(0xffe76681), 0xff, 0];
  return { packetType: 1, data, optionalData };
}

test('parses a fragmented ERP1 frame', () => {
  const frame = changeState(toHex(0xffe76681), toHex(0x0513cefe), 13);
  const parser = new Esp3Parser();
  expect(parser.push(frame.subarray(0, 5))).toHaveLength(0);
  const parsed = parser.push(frame.subarray(5));
  const radio = parseRadioERP1(parsed[0]);

  expect(parsed).toHaveLength(1);
  expect(radio).toMatchObject({ RORG: 0xd2, senderId: 'ffe76681', payload: [13, 0, 0, 0, 0, 0] });
});

test('builds a successful UTE teach-in response', () => {
  const response = buildUteTeachInResponse(0xffe76681, 0x05010203, [0, 0, 0, 0, 0, 0x50, 0xd2]);
  const parser = new Esp3Parser();
  const parsed = parser.push(response);

  expect(parsed).toHaveLength(1);
  expect(parsed[0].packetType).toBe(1);
  expect(parsed[0].data.slice(0, 8)).toEqual([0xd4, 0x91, 0, 0, 0, 0, 0x50, 0xd2]);
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
