import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from './registry';
import { TeachInManager } from './teachin';

test('collects and accepts a supported D2-50-00 candidate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  let responseTarget = 0;
  const manager = new TeachInManager(registry, 0xffe76685, async (candidate) => {
    responseTarget = candidate.targetId;
  });
  manager.start();
  manager.observe({
    RORG: 0xd4,
    senderId: '05010203',
    payload: [1, 2],
    teachIn: true,
    teachInInfo: { eep: { toString: () => 'd2-50-00' } },
  });

  const device = await manager.accept(0x05010203, {
    roomId: 'NEW',
    roomName: 'New devices',
    key: 'fan',
    name: 'New fan',
  });

  expect(device).toMatchObject({
    targetId: 0x05010203,
    sourceId: 0xffe76685,
    protocol: 'D2-50-00',
  });
  expect(responseTarget).toBe(0x05010203);
  expect(manager.listCandidates()).toHaveLength(0);
});

test('rejects unsupported teach-in profiles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  const manager = new TeachInManager(registry, 0xffe76685);
  manager.start();
  manager.observe({
    RORG: 0xd4,
    senderId: '05010204',
    payload: [],
    teachIn: true,
    teachInInfo: { eep: { toString: () => 'a5-02-05' } },
  });

  expect(
    manager.accept(0x05010204, {
      roomId: 'NEW',
      roomName: 'New devices',
      key: 'fan',
      name: 'Unknown',
    }),
  ).rejects.toThrow('Unsupported EEP');
});
