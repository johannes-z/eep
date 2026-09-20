import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from './registry';
import { applyRadioPacket } from './inbound';
import { decodeD2Value } from '../profiles/D2-50-00/profile';

test.each(['0513cefe-invalid', -1, 0x100000000, Number.NaN])(
  'rejects an invalid sender identifier %s before looking up a device',
  async (senderId) => {
    expect(
      applyRadioPacket({ RORG: 0xd2, senderId, payload: [1] }, {} as DeviceRegistry),
    ).rejects.toThrow('Invalid EnOcean sender ID');
  },
);

test('does not interpret raw control values or requests as D2 status', () => {
  expect(decodeD2Value([3])).toBeUndefined();
  expect(decodeD2Value([0xd1])).toBeUndefined();
  expect(decodeD2Value([0])).toBeUndefined();
  expect(decodeD2Value([])).toBeUndefined();
});

test('decodes D2-50-00 basic status operation modes', () => {
  expect(decodeD2Value([0x41, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(1);
  expect(decodeD2Value([0x4b, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0])).toBe(11);
  expect(decodeD2Value([0x60, 0xd8, 0x57, 0x48, 0x00, 0x00])).toBeUndefined();
});

test('reconciles a known device report with its desired state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-inbound-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  await registry.update(0xffe76681, {
    desiredState: { isOn: true, percentage: 75, d2Value: 3 },
  });

  const result = await applyRadioPacket(
    { RORG: 0xd2, senderId: '0513cefe', payload: [0x4d, ...Array(13).fill(0)] },
    registry,
  );
  const device = registry.findByTargetId(0x0513cefe);

  expect(result?.value).toBe(13);
  expect(device?.reportedState).toMatchObject({ d2Value: 13, preset: 'Supply' });
  expect(device?.desiredState).toBeUndefined();
  expect(device?.availability).toBe('online');
});

test('treats a physical D2-50-00 status as authoritative', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-inbound-physical-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  await registry.update(0xffe76682, {
    desiredState: { isOn: true, percentage: 100, d2Value: 4 },
  });

  const result = await applyRadioPacket(
    {
      RORG: 0xd2,
      senderId: '05126787',
      payload: [0x41, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0],
    },
    registry,
  );
  const device = registry.findByTargetId(0x05126787);

  expect(result?.value).toBe(1);
  expect(device?.reportedState).toMatchObject({ d2Value: 1, isOn: true, percentage: 25 });
  expect(device?.desiredState).toBeUndefined();
});
