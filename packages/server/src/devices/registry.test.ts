import { expect, test } from 'bun:test';
import { Database } from 'bun:sqlite';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { DeviceRegistry } from './registry';
import { sendDeviceCommand } from './commands';
import { applyRadioPacket } from './inbound';
import { f6Profile } from '../profiles/F6-02-01/profile';
import { stringify } from 'yaml';

test('isolates nested state at registry input, read and notification boundaries', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-snapshots-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  try {
    const state = { isOn: true, percentage: 25, d2Value: 1 };
    registry.onChange((device) => {
      (device.reportedState as typeof state).percentage = 99;
    });
    const pending = registry.update(0xffe76681, { reportedState: state });
    state.percentage = 50;
    const saved = await pending;
    (saved.reportedState as typeof state).percentage = 75;
    const listed = registry.list()[0];
    (listed.capabilities as string[]).push('invalid');
    const found = registry.findBySourceId(0xffe76681)!;
    (found.reportedState as typeof state).percentage = 100;
    expect(registry.findByTargetId(0x0513cefe)?.reportedState).toEqual({
      isOn: true,
      percentage: 25,
      d2Value: 1,
    });
    expect(registry.list()[0].capabilities).not.toContain('invalid');
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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

test('resets momentary reports on startup without losing other device state', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-momentary-'));
  const filePath = join(directory, 'configuration.yaml');
  let registry = await DeviceRegistry.load(filePath);
  try {
    const press = { messageType: 'N', pressed: true, buttons: ['AI', 'BI'] };
    const rocker = await registry.upsert({
      sourceId: 0xffe76685,
      targetId: 0x05010203,
      name: 'Wall rocker',
      profileId: 'F6-02-01',
      capabilities: ['rocker'],
      availability: 'online',
      lastSeen: '2026-09-22T12:00:00.000Z',
      reportedState: press,
    });
    await registry.upsert({
      sourceId: 0xffe76686,
      targetId: 0x05010204,
      name: 'Window contact',
      profileId: 'D5-00-01',
      capabilities: ['contact'],
      availability: 'unknown',
    });
    await applyRadioPacket({ RORG: 0xd5, senderId: '05010204', payload: [0x08] }, registry);
    const contact = registry.findBySourceId(0xffe76686);
    const fan = await registry.update(0xffe76681, {
      reportedState: { isOn: true, percentage: 25, d2Value: 1 },
      desiredState: { isOn: true, percentage: 75, d2Value: 3 },
    });
    expect(registry.findBySourceId(rocker.sourceId)?.reportedState).toEqual(press);
    for (let restart = 0; restart < 2; restart += 1) {
      await registry.close();
      registry = await DeviceRegistry.load(filePath);
      const restored = registry.findBySourceId(rocker.sourceId)!;
      const { reportedState: _reportedState, ...metadata } = rocker;
      expect(restored).toEqual(metadata);
      expect(f6Profile.entity!.projectState(restored)).toEqual({ isOn: false });
      expect(registry.findBySourceId(contact!.sourceId)).toEqual(contact);
      expect(registry.findBySourceId(fan.sourceId)).toEqual(fan);
      const database = new Database(join(directory, 'state.db'));
      try {
        expect(
          database
            .query('SELECT reported_state FROM device_runtime_state WHERE source_id = ?')
            .get(rocker.sourceId),
        ).toEqual({ reported_state: null });
      } finally {
        database.close();
      }
    }
    await registry.update(rocker.sourceId, { reportedState: press });
    expect(registry.findBySourceId(rocker.sourceId)?.reportedState).toEqual(press);
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('separates a receive-only identity from a reusable transmit address', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-transmit-'));
  const filePath = join(directory, 'configuration.yaml');
  let registry = await DeviceRegistry.load(filePath);
  try {
    const rocker = await registry.upsert({
      sourceId: 0xffe76685,
      targetId: 0x05010203,
      name: 'Existing rocker',
      profileId: 'F6-02-01',
      capabilities: ['rocker'],
      availability: 'online',
    });
    expect(rocker.transmitId).toBeNull();
    expect(registry.findByTransmitId(rocker.sourceId)).toBeUndefined();
    const fan = await registry.upsert({
      ...registry.list()[0],
      sourceId: 0x05010204,
      targetId: 0x05010204,
      transmitId: rocker.sourceId,
    });
    expect(registry.findByTransmitId(rocker.sourceId)?.sourceId).toBe(fan.sourceId);
    const packets: Uint8Array[] = [];
    await sendDeviceCommand(
      {
        write: async (packet) => {
          packets.push(packet);
        },
      },
      registry,
      fan,
      { value: 1 },
    );
    expect(Array.from(packets[0].slice(-13, -9))).toEqual([0xff, 0xe7, 0x66, 0x85]);
    expect(
      sendDeviceCommand(
        {
          write: async () => {
            throw new Error('Unexpected write');
          },
        },
        registry,
        rocker,
        { isOn: true },
      ),
    ).rejects.toThrow('read-only');
    await registry.close();
    const configuration = Bun.YAML.parse(await readFile(filePath, 'utf8')) as {
      devices: Record<string, Record<string, unknown>>;
    };
    delete configuration.devices.ffe76685.transmitId;
    await Bun.write(filePath, stringify(configuration));
    registry = await DeviceRegistry.load(filePath);
    expect(registry.findBySourceId(rocker.sourceId)?.transmitId).toBeNull();
    expect(registry.findByTransmitId(rocker.sourceId)?.sourceId).toBe(fan.sourceId);
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
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
    `devices:\n  ${seed.sourceId.toString(16)}:\n    targetId: '${seed.targetId.toString(16)}'\n    profileId: A5-02-05\n    capabilities:\n      contact: true\n`,
  );

  const registry = await DeviceRegistry.load(filePath);
  const device = registry.list()[0];
  expect(device).toMatchObject({
    profileId: 'A5-02-05',
    capabilities: { contact: true },
    availability: 'unknown',
  });
  expect(
    sendDeviceCommand({ write: async () => undefined }, registry, device, { value: 'toggle' }),
  ).rejects.toThrow('Unsupported EEP profile');
});

test('persists runtime changes without rewriting user configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-runtime-only-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);
  try {
    const configuration = `# user formatting\n${await readFile(filePath, 'utf8')}`;
    await Bun.write(filePath, configuration);
    await registry.update(0xffe76681, { availability: 'online' });
    expect(await readFile(filePath, 'utf8')).toBe(configuration);
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects conflicting identifiers without changing the registry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-invariants-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  try {
    const devices = registry.list();
    expect(
      registry.update(devices[0].sourceId, {
        targetId: devices[1].targetId,
      }),
    ).rejects.toThrow('Duplicate targetId');
    expect(
      registry.update(devices[0].sourceId, {
        sourceId: devices[1].sourceId,
      }),
    ).rejects.toThrow('reassignSourceId');
    expect(registry.list()).toEqual(devices);
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not publish a mutation when configuration persistence fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-registry-write-failure-'));
  const filePath = join(directory, 'configuration.yaml');
  const registry = await DeviceRegistry.load(filePath);
  try {
    const devices = registry.list();
    let notifications = 0;
    registry.onChange(() => {
      notifications += 1;
    });
    await rm(filePath);
    await mkdir(filePath);
    expect(registry.update(devices[0].sourceId, { name: 'Unsaved' })).rejects.toThrow();
    expect(registry.list()).toEqual(devices);
    expect(notifications).toBe(0);
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});
