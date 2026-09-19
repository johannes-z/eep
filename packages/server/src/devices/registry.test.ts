import { expect, test } from 'bun:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { DeviceRegistry } from './registry';

test('loads configured devices and persists updates by target ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-'));
  const filePath = join(directory, 'states.json');
  const registry = await DeviceRegistry.load(filePath);

  expect(registry.list()).toHaveLength(4);
  expect(registry.list()[0].supportedFunctions).toEqual([
    'off',
    'level1',
    'level2',
    'level3',
    'level4',
    'automatic',
    'supplyOnly',
    'exhaustOnly',
  ]);
  await registry.update(0x0513cefe, {
    name: 'Living Room Extractor',
    desiredState: { isOn: true, percentage: 75, d2Value: 3 },
  });

  const restored = await DeviceRegistry.load(filePath);
  const device = restored.findByTargetId(0x0513cefe);
  expect(device).toMatchObject({
    name: 'Living Room Extractor',
    roomId: 'E04',
    desiredState: { percentage: 75, d2Value: 3 },
  });

  const states = JSON.parse(await readFile(filePath, 'utf8')) as {
    devices: Array<{ sourceId: string; targetId: string }>;
  };
  expect(states.devices[0]).toMatchObject({ sourceId: 'ffe76681', targetId: '0513cefe' });
});

test('persists device removal without re-seeding the initial states', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-remove-'));
  const filePath = join(directory, 'states.json');
  const registry = await DeviceRegistry.load(filePath);

  expect(await registry.remove(0x0513cefe)).toBe(true);

  const restored = await DeviceRegistry.load(filePath);
  expect(restored.findByTargetId(0x0513cefe)).toBeUndefined();
  expect(restored.list()).toHaveLength(3);
  expect(await restored.remove(0x0513cefe)).toBe(false);
});

test('rejects partially parsed persisted identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-invalid-'));
  const filePath = join(directory, 'states.json');
  await Bun.write(
    filePath,
    JSON.stringify({
      devices: [
        {
          ...JSON.parse(JSON.stringify((await DeviceRegistry.load(filePath)).list()[0])),
          targetId: '0513cefe-invalid',
        },
      ],
    }),
  );

  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Invalid targetId');
});

test('rejects malformed persisted device fields and fan state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-schema-'));
  const filePath = join(directory, 'states.json');
  const registry = await DeviceRegistry.load(filePath);
  const device = registry.list()[0];
  await Bun.write(filePath, JSON.stringify({ version: 1, devices: [{ ...device, roomName: 42 }] }));
  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Invalid roomName');

  await Bun.write(
    filePath,
    JSON.stringify({
      version: 1,
      devices: [{ ...device, desiredState: { isOn: true, percentage: 50, d2Value: 15 } }],
    }),
  );
  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Invalid desiredState.d2Value');
});

test('rejects duplicate persisted target identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-duplicates-'));
  const filePath = join(directory, 'states.json');
  const registry = await DeviceRegistry.load(filePath);
  const devices = registry.list();
  devices[1].targetId = devices[0].targetId;
  await Bun.write(filePath, JSON.stringify({ version: 1, devices }));

  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Duplicate targetId');
});

test('serializes concurrent updates without losing either mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-concurrent-'));
  const filePath = join(directory, 'states.json');
  const registry = await DeviceRegistry.load(filePath);

  await Promise.all([
    registry.update(0x0513cefe, { name: 'Updated living room' }),
    registry.update(0x05126787, { name: 'Updated office' }),
  ]);

  expect(registry.findByTargetId(0x0513cefe)?.name).toBe('Updated living room');
  expect(registry.findByTargetId(0x05126787)?.name).toBe('Updated office');
  const restored = await DeviceRegistry.load(filePath);
  expect(restored.findByTargetId(0x0513cefe)?.name).toBe('Updated living room');
  expect(restored.findByTargetId(0x05126787)?.name).toBe('Updated office');
});
