import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from './registry';
import { applyRadioPacket, decodeD2Value } from './inbound';

test('decodes raw and packed D2 operating values', () => {
  expect(decodeD2Value([3])).toBe(3);
  expect(decodeD2Value([0xd1])).toBe(13);
  expect(decodeD2Value([0])).toBe(0);
  expect(decodeD2Value([])).toBeUndefined();
});

test('reconciles a known device report with its desired state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-inbound-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  await registry.update(0x0513cefe, {
    desiredState: { isOn: true, percentage: 75, d2Value: 3 },
  });

  const result = await applyRadioPacket(
    { RORG: 0xd2, senderId: '0513cefe', payload: [0xd1] },
    registry,
  );
  const device = registry.findByTargetId(0x0513cefe);

  expect(result?.value).toBe(13);
  expect(device?.reportedState).toMatchObject({ d2Value: 13, preset: 'Supply' });
  expect(device?.desiredState?.d2Value).toBe(3);
  expect(device?.availability).toBe('online');
});
