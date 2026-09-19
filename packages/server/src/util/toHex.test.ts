import { expect, test } from 'bun:test';
import { toHex } from './toHex';

test('serializes IDs as fixed-width big-endian bytes', () => {
  expect(toHex(0x0513cefe)).toEqual([0x05, 0x13, 0xce, 0xfe]);
  expect(toHex(0x00000001)).toEqual([0, 0, 0, 1]);
});

test('rejects IDs outside the unsigned 32-bit range', () => {
  expect(() => toHex(-1)).toThrow();
  expect(() => toHex(0x100000000)).toThrow();
});
