import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { DeviceRegistry } from './registry';
import { sendDeviceCommand } from './commands';

test('loads configured devices and persists updates by source ID', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);

  expect(registry.list()).toHaveLength(4);
  expect(registry.list()[0].capabilities).toEqual([
    'off',
    'level1',
    'level2',
    'level3',
    'level4',
    'automatic',
    'supplyOnly',
    'exhaustOnly',
  ]);
  await registry.update(0xffe76681, {
    desiredState: { isOn: true, percentage: 75, d2Value: 3 },
  });

  const restored = await DeviceRegistry.load(filePath);
  const device = restored.findByTargetId(0x0513cefe);
  expect(device).toMatchObject({
    sourceId: 0xffe76681,
    desiredState: { isOn: true, percentage: 75, d2Value: 3 },
  });
  expect(await Bun.file(join(directory, 'state.db')).exists()).toBe(true);

  const configuration = Bun.YAML.parse(await readFile(filePath, 'utf8')) as {
    version: number;
    devices: Record<string, Record<string, unknown>>;
  };
  expect(configuration.version).toBe(1);
  expect(configuration.devices.ffe76681).toMatchObject({
    name: 'Living Room vent',
    profileId: 'D2-50-00',
    targetId: '0513cefe',
  });
  expect(configuration.devices.ffe76681).not.toHaveProperty('desiredState');
  expect(configuration.devices.ffe76681).not.toHaveProperty('roomName');
});

test('persists device removal without re-seeding the initial states', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-remove-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);
  await registry.update(0xffe76681, {
    desiredState: { isOn: true, percentage: 25, d2Value: 1 },
  });

  expect(await registry.remove(0xffe76681)).toBe(true);
  const database = new Database(join(directory, 'state.db'));
  expect(
    database
      .query('SELECT source_id FROM device_runtime_state WHERE source_id = ?')
      .get(0xffe76681),
  ).toBeNull();
  database.close();

  const restored = await DeviceRegistry.load(filePath);
  expect(restored.findByTargetId(0x0513cefe)).toBeUndefined();
  expect(restored.list()).toHaveLength(3);
  expect(await restored.remove(0xffe76681)).toBe(false);
});

test('rejects partially parsed persisted identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-invalid-'));
  const filePath = join(directory, 'configuration.yaml');
  await Bun.write(
    filePath,
    'devices:\n  ffe76681:\n    targetId: 0513cefe-invalid\n    profileId: D2-50-00\n',
  );

  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Invalid targetId');
});

test('rejects malformed persisted device fields and fan state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-schema-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);
  const device = registry.list()[0];
  await Bun.write(
    filePath,
    `devices:\n  ${device.sourceId.toString(16)}:\n    targetId: '${device.targetId.toString(16)}'\n    profileId: D2-50-00\n    capabilities: [invalid]\n`,
  );
  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Invalid D2-50-00 capabilities');
});

test('rejects runtime state that violates profile validation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-runtime-state-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);
  await registry.update(0xffe76681, {
    reportedState: { isOn: true, percentage: 25, d2Value: 1 },
  });
  await registry.close();

  const database = new Database(join(directory, 'state.db'));
  database.run('UPDATE device_runtime_state SET reported_state = ? WHERE source_id = ?', [
    JSON.stringify({ isOn: true }),
    0xffe76681,
  ]);
  database.close();

  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Invalid reportedState.percentage');
});

test('rejects duplicate persisted target identifiers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-duplicates-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);
  const devices = registry.list();
  await Bun.write(
    filePath,
    `devices:\n  ${devices[0].sourceId.toString(16)}:\n    targetId: '${devices[0].targetId.toString(16)}'\n    profileId: D2-50-00\n  ${devices[1].sourceId.toString(16)}:\n    targetId: '${devices[0].targetId.toString(16)}'\n    profileId: D2-50-00\n`,
  );

  expect(DeviceRegistry.load(filePath)).rejects.toThrow('Duplicate targetId');
});

test('serializes concurrent updates without losing either mutation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-concurrent-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);

  await Promise.all([
    registry.update(0xffe76681, { availability: 'online' }),
    registry.update(0xffe76682, { availability: 'online' }),
  ]);

  expect(registry.findBySourceId(0xffe76681)?.availability).toBe('online');
  expect(registry.findBySourceId(0xffe76682)?.availability).toBe('online');
});

test('retains unknown profiles as unavailable opaque devices', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-unknown-'));
  const filePath = join(directory, 'configuration.yaml');
  const seed = (await DeviceRegistry.load(filePath)).list()[0];
  await Bun.write(
    filePath,
    `devices:\n  ${seed.sourceId.toString(16)}:\n    targetId: '${seed.targetId.toString(16)}'\n    profileId: D5-00-01\n    capabilities:\n      contact: true\n`,
  );

  const registry = await DeviceRegistry.load(filePath);
  const device = registry.list()[0];
  expect(device).toMatchObject({
    profileId: 'D5-00-01',
    capabilities: { contact: true },
    availability: 'unknown',
  });
  expect(
    sendDeviceCommand({ write: async () => undefined }, registry, device, { value: 'toggle' }),
  ).rejects.toThrow('Unsupported EEP profile');
});
