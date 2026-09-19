import { expect, test } from 'bun:test';
import { changeState } from '../api/D2-50-00/changeState';
import { toHex } from '../util/toHex';
import { buildUteTeachInResponse, Esp3Parser, parseRadioERP1 } from './esp3';

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
  const response = buildUteTeachInResponse(0xffe76681, 0x05010203, [0, 0, 0, 0, 0, 0]);
  const parser = new Esp3Parser();
  const parsed = parser.push(response);

  expect(parsed).toHaveLength(1);
  expect(parsed[0].packetType).toBe(1);
  expect(parsed[0].data.slice(0, 7)).toEqual([0xd4, 0x91, 0, 0, 0, 0, 0]);
  expect(parsed[0].optionalData.slice(0, 5)).toEqual([3, 0x05, 0x01, 0x02, 0x03]);
});
