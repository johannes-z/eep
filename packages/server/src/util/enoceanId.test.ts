import { expect, test } from 'bun:test';
import { formatEnOceanId, parseEnOceanId } from './enoceanId';

test('formats high-bit IDs as canonical hexadecimal route values', () => {
  const sourceId = 0xffe76682;

  expect(formatEnOceanId(sourceId)).toBe('ffe76682');
  expect(parseEnOceanId(formatEnOceanId(sourceId))).toBe(sourceId);
});
