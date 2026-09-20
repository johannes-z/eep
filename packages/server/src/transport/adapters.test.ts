import { expect, test } from 'bun:test';
import { openTransport } from './adapters';

test('disabled transport rejects commands instead of silently dropping them', async () => {
  const connection = await openTransport({
    type: 'none',
    path: '',
    baudRate: 57600,
    rtscts: false,
  });

  expect(() => connection.write(new Uint8Array([1]))).toThrow('EnOcean transport is not connected');
});
