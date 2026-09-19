import { expect, test } from 'bun:test';
import { isTcpPath, parseTcpPath } from './socketPath';

test('validates TCP adapter paths without stateful regex behavior', () => {
  expect(isTcpPath('tcp://192.168.1.49:20108')).toBe(true);
  expect(isTcpPath('tcp://adapter.local:1')).toBe(true);
  expect(isTcpPath('tcp://adapter.local:65535')).toBe(true);
  expect(isTcpPath('tcp://adapter.local:0')).toBe(false);
  expect(isTcpPath('tcp://adapter.local:65536')).toBe(false);
  expect(isTcpPath('tcp://adapter.local:not-a-port')).toBe(false);
  expect(isTcpPath('tcp://adapter.local:20108')).toBe(true);
});

test('parses a validated TCP adapter path', () => {
  expect(parseTcpPath('tcp://adapter.local:20108')).toEqual({
    host: 'adapter.local',
    port: 20108,
  });
  expect(() => parseTcpPath('tcp://adapter.local:0')).toThrow('Invalid TCP adapter path');
});
