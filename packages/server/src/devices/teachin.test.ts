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

  const device = await manager.accept(0x05010203, {
    roomId: 'NEW',
    roomName: 'New devices',
    key: 'fan',
    name: 'New fan',
  });

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

test('rejects unsupported teach-in profiles', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
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
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
  const responses: string[] = [];
  const manager = new TeachInManager(registry, 0xffe76685, async (_candidate, result) => {
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
  await new Promise((resolve) => setTimeout(resolve, 0));

  expect(registry.findByTargetId(0x0513cefe)?.teachIn).toMatchObject({
    eep: 'D2-50-00',
    channel: 0xff,
    manufacturerId: 0x000b,
  });
  expect(responses).toEqual(['teachInAccepted']);
  expect(manager.listCandidates()).toHaveLength(0);
});

test('does not answer one-way teach-in and rejects teach-out requests', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-'));
  const registry = await DeviceRegistry.load(join(directory, 'states.json'));
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
