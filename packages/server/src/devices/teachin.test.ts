import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from './registry';
import { TeachInManager } from './teachin';

test('pairing expires automatically and notifies subscribers', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-expiry-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  const stopped = new Promise<void>((resolve) => {
    manager.onStateChange((active) => {
      if (!active) resolve();
    });
  });
  manager.start(10);
  await stopped;
  expect(manager.isActive()).toBe(false);
  await registry.close();
});

test('failed transmission closes the pairing session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-failed-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685, undefined, undefined, async () => {
    throw new Error('Disconnected');
  });
  manager.start();
  expect(manager.transmit(0xffe76686)).rejects.toThrow('Disconnected');
  expect(manager.isActive()).toBe(false);
  await registry.close();
});

test('stopping pairing clears targeted allocation before another session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-cancel-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  manager.start();
  await manager.transmit(0xffe76686);
  manager.stop();
  manager.start();
  const candidate = manager.observe({
    RORG: 0xd4,
    senderId: '05010203',
    payload: [0x80, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });
  expect(candidate?.sourceId).toBe(0xffe76685);
  expect(manager.listCandidates()).toHaveLength(1);
  manager.stop();
  expect(manager.listCandidates()).toHaveLength(0);
  await registry.close();
});

test('collects and accepts a supported D2-50-00 candidate', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  let responseTarget = 0;
  const responses: string[] = [];
  const manager = new TeachInManager(registry, 0xffe76685, async (candidate, result) => {
    responseTarget = candidate.targetId;
    responses.push(result);
  });
  manager.start();
  manager.observe({
    RORG: 0xd4,
    senderId: '05010203',
    payload: [0x80, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });

  const device = await manager.accept(0x05010203);

  expect(device).toMatchObject({
    targetId: 0x05010203,
    sourceId: 0xffe76685,
    profileId: 'D2-50-00',
    teachIn: {
      eep: 'D2-50-00',
      channel: 0xff,
      manufacturerId: 0x000b,
      direction: 'bidirectional',
      responseExpected: true,
    },
  });
  expect(responseTarget).toBe(0x05010203);
  expect(responses).toEqual(['teachInAccepted']);
  expect(manager.listCandidates()).toHaveLength(0);
});

test('allocates the next free sender ID when the controller ID is already paired', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  let responseSourceId: number | undefined;
  const manager = new TeachInManager(registry, 0xffe76681, async (candidate) => {
    responseSourceId = candidate.sourceId;
  });
  manager.start();
  manager.observe({
    RORG: 0xd4,
    senderId: '05010207',
    payload: [0x80, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });

  const device = await manager.accept(0x05010207);

  expect(device.sourceId).toBe(0xffe76685);
  expect(responseSourceId).toBe(device.sourceId);
  expect(registry.findBySourceId(0xffe76681)?.name).toBe('Living Room vent');
  expect(registry.findByTargetId(0x05010207)?.sourceId).toBe(0xffe76685);
});

test('reserves distinct sender IDs before acknowledging concurrent candidates', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-reservations-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const responses = new Map<number, number>();
  const manager = new TeachInManager(registry, 0xffe76681, async (candidate) => {
    responses.set(candidate.targetId, candidate.sourceId);
  });
  try {
    manager.start();
    for (const senderId of ['05010207', '05010208', '05010207']) {
      manager.observe({
        RORG: 0xd4,
        senderId,
        payload: [0x80, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
        teachIn: true,
        teachInInfo: {
          control: 0x80,
          channel: 0xff,
          manufacturer: 0x000b,
          eep: 'd2-50-00',
          direction: 'bidirectional',
          responseExpected: true,
          requestType: 'teachIn',
          command: 'query',
        },
      });
    }
    const devices = await Promise.all([manager.accept(0x05010207), manager.accept(0x05010208)]);
    expect(devices.map((device) => device.sourceId)).toEqual([0xffe76685, 0xffe76686]);
    for (const device of devices) {
      expect(responses.get(device.targetId)).toBe(device.sourceId);
      expect(registry.findByTargetId(device.targetId)?.sourceId).toBe(device.sourceId);
    }
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('uses an explicitly selected sender ID for the UTE signal', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-targeted-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  let signalSourceId = 0;
  const manager = new TeachInManager(
    registry,
    0xffe76681,
    undefined,
    undefined,
    async (sourceId) => {
      signalSourceId = sourceId;
    },
  );

  manager.start();
  await manager.transmit(0xffe76685);

  expect(signalSourceId).toBe(0xffe76685);
});

test('automatically accepts a response from a targeted pairing session', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-auto-accept-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76681);
  manager.start();
  await manager.transmit(0xffe76685);
  manager.observe({
    RORG: 0xd4,
    senderId: '05010208',
    payload: [0x91, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
    teachIn: false,
    teachInInfo: {
      control: 0x91,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: false,
      requestType: 'teachOut',
      command: 'response',
      response: 'teachInAccepted',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));

  expect(registry.findByTargetId(0x05010208)?.sourceId).toBe(0xffe76685);
  expect(manager.listCandidates()).toHaveLength(0);
  expect(manager.isActive()).toBe(false);
});

test('rejects unsupported teach-in profiles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  let response: string | undefined;
  const manager = new TeachInManager(registry, 0xffe76685, async (_candidate, result) => {
    response = result;
  });
  manager.start();
  const candidate = manager.observe({
    RORG: 0xd4,
    senderId: '05010204',
    payload: [0x80, 0xff, 0x0b, 0, 0xa5, 2, 5],
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'a5-02-05',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });

  expect(candidate).toBeUndefined();
  expect(response).toBe('eepNotSupported');
  expect(manager.listCandidates()).toHaveLength(0);
});

test('backfills teach-in metadata for an existing device', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const responses: string[] = [];
  const responseSources: number[] = [];
  const manager = new TeachInManager(registry, 0xffe76685, async (candidate, result) => {
    responseSources.push(candidate.sourceId);
    responses.push(result);
  });
  manager.start();

  expect(
    manager.observe({
      RORG: 0xd4,
      senderId: '0513cefe',
      payload: [0x80, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
      teachIn: true,
      teachInInfo: {
        control: 0x80,
        channel: 0xff,
        manufacturer: 0x000b,
        eep: 'd2-50-00',
        direction: 'bidirectional',
        responseExpected: true,
        requestType: 'teachIn',
        command: 'query',
      },
    }),
  ).toBeUndefined();
  await new Promise((resolve) => setTimeout(resolve, 25));

  expect(registry.findByTargetId(0x0513cefe)?.teachIn).toMatchObject({
    eep: 'D2-50-00',
    channel: 0xff,
    manufacturerId: 0x000b,
  });
  expect(responses).toEqual(['teachInAccepted']);
  expect(responseSources).toEqual([0xffe76681]);
  expect(manager.listCandidates()).toHaveLength(0);
});

test('re-pairing an existing target preserves its assigned sender channel', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-repair-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  let responseSource = 0;
  const manager = new TeachInManager(registry, 0xffe76685, async (candidate) => {
    responseSource = candidate.sourceId;
  });
  manager.start();
  manager.observe({
    RORG: 0xd4,
    senderId: '05126787',
    payload: [0x80, 0xff, 0x61, 0, 0xd2, 0x50, 0],
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x0061,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));

  expect(responseSource).toBe(0xffe76682);
  expect(registry.findByTargetId(0x05126787)?.sourceId).toBe(0xffe76682);
});

test('moves an existing target to an explicitly selected sender channel', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-targeted-repair-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76681);
  manager.start();
  await manager.transmit(0xffe76685);
  manager.observe({
    RORG: 0xd4,
    senderId: '05126787',
    payload: [0x80, 0xff, 0x61, 0, 0xd2, 0x50, 0],
    teachIn: true,
    teachInInfo: {
      control: 0x80,
      channel: 0xff,
      manufacturer: 0x0061,
      eep: 'd2-50-00',
      direction: 'bidirectional',
      responseExpected: true,
      requestType: 'teachIn',
      command: 'query',
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 25));

  expect(registry.findBySourceId(0xffe76682)).toBeUndefined();
  expect(registry.findByTargetId(0x05126787)?.sourceId).toBe(0xffe76685);
});

test('does not answer one-way teach-in and rejects teach-out requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const responses: string[] = [];
  const manager = new TeachInManager(registry, 0xffe76685, async (_candidate, result) => {
    responses.push(result);
  });
  manager.start();

  const candidate = manager.observe({
    RORG: 0xd4,
    senderId: '05010205',
    payload: [0x40, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
    teachIn: true,
    teachInInfo: {
      control: 0x40,
      channel: 0xff,
      manufacturer: 0x000b,
      eep: 'd2-50-00',
      direction: 'unidirectional',
      responseExpected: false,
      requestType: 'teachIn',
      command: 'query',
    },
  });
  expect(candidate?.targetId).toBe(0x05010205);
  expect(responses).toEqual([]);

  expect(
    manager.observe({
      RORG: 0xd4,
      senderId: '05010206',
      payload: [0x90, 0xff, 0x0b, 0, 0xd2, 0x50, 0],
      teachIn: false,
      teachInInfo: {
        control: 0x90,
        channel: 0xff,
        manufacturer: 0x000b,
        eep: 'd2-50-00',
        direction: 'bidirectional',
        responseExpected: true,
        requestType: 'teachOut',
        command: 'query',
      },
    }),
  ).toBeUndefined();
  expect(responses).toEqual(['general']);
  expect(manager.listCandidates()).toHaveLength(1);
});
