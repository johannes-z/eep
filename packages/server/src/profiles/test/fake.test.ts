import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sendDeviceCommand } from '../../devices/commands';
import { applyRadioPacket } from '../../devices/inbound';
import { DeviceRegistry } from '../../devices/registry';
import { ProfileRegistry } from '../registry';
import { fakeProfile } from './fake';

test('supports a non-fan profile through generic ingress and egress dispatch', async () => {
  const profiles = new ProfileRegistry([fakeProfile]);
  const directory = await mkdtemp(join(tmpdir(), 'eep-fake-profile-'));
  const filePath = join(directory, 'configuration.yaml');
  await Bun.write(
    filePath,
    "devices:\n  ffe76681:\n    targetId: '05010203'\n    profileId: D5-00-01\n    capabilities: [contact]\n",
  );
  const registry = await DeviceRegistry.load(filePath, profiles);
  const inbound = await applyRadioPacket(
    { RORG: 0xd5, senderId: '05010203', payload: [1] },
    registry,
    profiles,
  );

  expect(inbound?.value).toBe(true);
  expect(registry.findByTargetId(0x05010203)?.reportedState).toEqual({ contact: true });
  expect(
    profiles.require('d5-00-01').entity?.describe({
      sourceId: 0,
      targetId: 0x05010203,
      capabilities: ['contact'],
    }).kind,
  ).toBe('binary_sensor');

  const writes: Uint8Array[] = [];
  await sendDeviceCommand(
    { write: async (payload: Uint8Array) => writes.push(payload) } as never,
    registry,
    registry.findByTargetId(0x05010203)!,
    { value: 'open' },
    profiles,
  );
  expect(Array.from(writes[0])).toEqual([0xd5, 1]);
});
