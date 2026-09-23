import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from './registry';
import { TeachInManager } from './teachin';
import { applyRadioPacket } from './inbound';
import { build4bsTeachInResponse, Esp3Parser, parseRadioERP1 } from '../transport/esp3';
import type { RadioERP1Packet } from './inbound';

test.each([false, true])(
  'pairs MVA005 with an immediate 4BS variation 3 response (targeted: %s)',
  async (targeted) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-mva005-'));
    const filePath = join(directory, 'configuration.yaml');
    let registry = await DeviceRegistry.load(filePath);
    const replies: number[][] = [];
    const manager = new TeachInManager(registry, 0xffe76685, async (candidate, result) => {
      expect(candidate.protocol).toBe('4bs');
      expect(registry.findByTargetId(candidate.targetId)).toBeUndefined();
      const frame = new Esp3Parser().push(
        build4bsTeachInResponse(
          candidate.sourceId,
          candidate.targetId,
          candidate.requestPayload,
          result,
        ),
      )[0];
      replies.push(frame.data);
    });
    const query = { RORG: 0xa5, senderId: 0x05010203, payload: [0x80, 0x30, 0x49, 0x80] };
    try {
      expect(manager.observe(query)).toBeUndefined();
      manager.start();
      if (targeted) await manager.transmit(0xffe76686);
      for (const payload of [
        [0x80, 0x30, 0x49, 0xf0],
        [0, 0, 0, 0],
        [0x80, 0x28, 0x49, 0x80],
        [22, 0xaa, 40, 8],
      ]) {
        expect(manager.observe({ ...query, payload })).toBeUndefined();
      }
      expect(manager.observe({ ...query, destinationId: 0x05009999 })).toBeUndefined();
      expect(manager.observe(query)).toMatchObject({
        eep: 'A5-20-06',
        manufacturer: 0x49,
        direction: 'bidirectional',
        protocol: '4bs',
      });
      expect(replies).toHaveLength(1);
      manager.observe(query);
      await manager.accept(query.senderId);
      expect(replies).toHaveLength(1);
      expect(replies[0].slice(0, 5)).toEqual([0xa5, 0x80, 0x30, 0x49, 0xf0]);
      expect(registry.findByTargetId(query.senderId)).toMatchObject({
        sourceId: targeted ? 0xffe76686 : 0xffe76685,
        profileId: 'A5-20-06',
        teachIn: { manufacturerId: 0x49, direction: 'bidirectional', responseExpected: true },
      });
      expect(manager.isActive()).toBe(!targeted);
      expect(await registry.remove(targeted ? 0xffe76686 : 0xffe76685)).toBe(true);
      expect(registry.listIgnoredDevices()).toEqual([]);
      manager.stop();
      manager.start();
      if (targeted) await manager.transmit(0xffe76686);
      expect(manager.observe({ ...query, payload: [0x00, 0xaa, 0x39, 0x68] })).toBeUndefined();
      expect(manager.listCandidates()).toEqual([]);
      expect(manager.observe(query)).toMatchObject({ eep: 'A5-20-06', protocol: '4bs' });
      await manager.accept(query.senderId);
      expect(replies).toHaveLength(2);
      expect(replies[1]).toEqual(replies[0]);
      await registry.close();
      registry = await DeviceRegistry.load(filePath);
      expect(registry.findByTargetId(query.senderId)?.profileId).toBe('A5-20-06');
    } finally {
      manager.stop();
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('requires explicit EEP teach-in for passive A5 sensor discovery', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-a5-sensor-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const responses: string[] = [];
  const manager = new TeachInManager(registry, 0xffe76685, async (_candidate, response) => {
    responses.push(response);
  });
  const packet = { RORG: 0xa5, senderId: 0x051a8f95, payload: [0x10, 0x08, 0x46, 0x80] };
  try {
    for (const payload of [
      [0x00, 0x85, 0x91, 0x0a],
      [0x00, 0xaa, 0x39, 0x68],
      [0x00, 0x00, 0x00, 0x00],
      [0x10, 0x08, 0x46, 0xf0],
      [0x80, 0x30, 0x49, 0x80],
    ]) {
      expect(manager.observe({ ...packet, payload })).toBeUndefined();
    }
    expect(manager.listCandidates()).toEqual([]);
    expect(manager.observe(packet)).toMatchObject({
      targetId: packet.senderId,
      receiveOnly: true,
      eep: 'A5-04-01',
      profileOptions: ['A5-04-01'],
    });
    await manager.accept(packet.senderId);
    expect(registry.findByTargetId(packet.senderId)).toMatchObject({
      sourceId: packet.senderId,
      transmitId: null,
      profileId: 'A5-04-01',
    });
    expect(responses).toEqual([]);
    await applyRadioPacket({ ...packet, payload: [0x00, 125, 125, 0x0a] }, registry);
    expect(registry.findByTargetId(packet.senderId)?.reportedState).toEqual({
      temperature: 20,
      humidity: 50,
    });
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('discovers and updates an A5-04-02 sensor from 4BS packets', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-a5-sensor-wide-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  const query = { RORG: 0xa5, senderId: 0x0582fd3c, payload: [0x10, 0x10, 0x46, 0x80] };
  try {
    expect(manager.observe(query)).toMatchObject({
      targetId: query.senderId,
      receiveOnly: true,
      eep: 'A5-04-02',
      profileOptions: ['A5-04-02'],
    });
    await manager.accept(query.senderId);
    expect(registry.findByTargetId(query.senderId)).toMatchObject({
      sourceId: query.senderId,
      transmitId: null,
      profileId: 'A5-04-02',
      teachIn: { eep: 'A5-04-02', direction: 'unidirectional', responseExpected: false },
    });

    await applyRadioPacket(
      { RORG: 0xa5, senderId: query.senderId, payload: [0, 0xa4, 0x88, 0x0f] },
      registry,
    );
    expect(registry.findByTargetId(query.senderId)?.reportedState).toEqual({
      temperature: 23.52,
      humidity: 65.6,
    });
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not persist a 4BS device when the handshake write fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-mva005-failure-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685, async () => {
    throw new Error('Disconnected');
  });
  const logging = spyOn(console, 'error').mockImplementation(() => undefined);
  try {
    manager.start();
    manager.observe({ RORG: 0xa5, senderId: 0x05010203, payload: [0x80, 0x30, 0x49, 0x80] });
    expect(manager.accept(0x05010203)).rejects.toThrow('Disconnected');
    expect(registry.findByTargetId(0x05010203)).toBeUndefined();
  } finally {
    manager.stop();
    logging.mockRestore();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([false, true])(
  'pairs a 1BS contact without a UTE response (targeted: %s)',
  async (targeted) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-contact-'));
    const filePath = join(directory, 'configuration.yaml');
    let registry = await DeviceRegistry.load(filePath);
    const responses: string[] = [];
    const manager = new TeachInManager(registry, 0xffe76685, async (_candidate, response) => {
      responses.push(response);
    });
    const packet = parseRadioERP1({
      packetType: 1,
      data: [0xd5, 0x01, 0x05, 0x01, 0x02, 0x03, 0],
      optionalData: [],
    });
    if (!packet) throw new Error('Expected a 1BS packet');
    try {
      expect(packet.teachIn).toBe(true);
      expect(packet.teachInInfo).toBeUndefined();
      if (targeted) {
        manager.start();
        await manager.transmit(0xffe76686);
      }
      expect(manager.observe(packet)).toMatchObject({
        eep: undefined,
        profileOptions: ['D5-00-01'],
        direction: 'unidirectional',
        responseExpected: false,
      });
      expect(registry.findByTargetId(0x05010203)).toBeUndefined();
      expect(await manager.accept(0x05010203).catch((error: Error) => error.message)).toBe(
        'Select an EEP for this teach-in candidate',
      );
      expect(
        await manager.accept(0x05010203, 'D2-50-00').catch((error: Error) => error.message),
      ).toBe('EEP does not match the teach-in telegram');
      await manager.accept(0x05010203, 'D5-00-01');
      const device = registry.findByTargetId(0x05010203);
      expect(device).toMatchObject({
        sourceId: 0x05010203,
        transmitId: null,
        profileId: 'D5-00-01',
        capabilities: ['contact'],
        teachIn: { eep: 'D5-00-01', direction: 'unidirectional', responseExpected: false },
      });
      expect(device?.teachIn?.manufacturerId).toBeUndefined();
      expect(device?.teachIn?.channel).toBeUndefined();
      expect(device?.reportedState).toBeUndefined();
      expect(responses).toEqual([]);
      expect(await applyRadioPacket(packet, registry)).toBeUndefined();
      await applyRadioPacket({ ...packet, payload: [0x08], teachIn: false }, registry);
      expect(registry.findByTargetId(0x05010203)?.reportedState).toEqual({ open: true });
      await applyRadioPacket({ ...packet, payload: [0x09], teachIn: false }, registry);
      expect(registry.findByTargetId(0x05010203)?.reportedState).toEqual({ open: false });
      manager.stop();
      await registry.close();
      registry = await DeviceRegistry.load(filePath);
      expect(registry.findByTargetId(0x05010203)).toMatchObject({
        profileId: 'D5-00-01',
        reportedState: { open: false },
        teachIn: { eep: 'D5-00-01', direction: 'unidirectional', responseExpected: false },
      });
    } finally {
      manager.stop();
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('discovers 1BS data outside pairing but ignores malformed telegrams', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-contact-invalid-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  try {
    for (const payload of [[], [0x01, 0x00], [-1], [0x100], [0.5]]) {
      expect(manager.observe({ RORG: 0xd5, senderId: '05010203', payload })).toBeUndefined();
    }
    expect(manager.listCandidates()).toEqual([]);
    for (const payload of [[0x08], [0x09]]) {
      expect(manager.observe({ RORG: 0xd5, senderId: '05010203', payload })).toMatchObject({
        receiveOnly: true,
        sourceId: 0x05010203,
        profileOptions: ['D5-00-01'],
      });
    }
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test.each([false, true])(
  'pairs an RPS rocker with explicit profile confirmation and no reply (targeted: %s)',
  async (targeted) => {
    const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-rocker-'));
    const filePath = join(directory, 'configuration.yaml');
    let registry = await DeviceRegistry.load(filePath);
    const responses: string[] = [];
    const manager = new TeachInManager(registry, 0xffe76685, async (_candidate, response) => {
      responses.push(response);
    });
    const packet = parseRadioERP1({
      packetType: 1,
      data: [0xf6, 0x15, 0x05, 0x01, 0x02, 0x03, 0x31],
      optionalData: [],
    });
    if (!packet) throw new Error('Expected an RPS packet');
    try {
      expect(packet.teachIn).toBe(false);
      if (targeted) {
        manager.start();
        await manager.transmit(0xffe76686);
      }
      expect(manager.observe(packet)).toMatchObject({
        sourceId: 0x05010203,
        receiveOnly: true,
        eep: undefined,
        profileOptions: ['F6-02-01'],
        direction: 'unidirectional',
        responseExpected: false,
      });
      expect(registry.findByTargetId(0x05010203)).toBeUndefined();
      expect(manager.accept(0x05010203)).rejects.toThrow('Select an EEP');
      expect(manager.accept(0x05010203, 'D5-00-01')).rejects.toThrow('EEP does not match');
      await manager.accept(0x05010203, 'F6-02-01');
      expect(registry.findByTargetId(0x05010203)).toMatchObject({
        sourceId: 0x05010203,
        profileId: 'F6-02-01',
        capabilities: ['rocker'],
        teachIn: { eep: 'F6-02-01', direction: 'unidirectional', responseExpected: false },
      });
      expect(responses).toEqual([]);
      expect(manager.listCandidates()).toEqual([]);
      expect(manager.observe(packet)).toBeUndefined();
      expect(manager.isActive()).toBe(targeted);
      expect((await applyRadioPacket(packet, registry))?.device.reportedState).toEqual({
        messageType: 'N',
        pressed: true,
        buttons: ['AI', 'BI'],
      });
      const release = { ...packet, payload: [0], status: 0x20 };
      expect((await applyRadioPacket(release, registry))?.device.reportedState).toEqual({
        messageType: 'U',
        pressed: false,
        buttonCount: 0,
      });
      expect(await applyRadioPacket({ ...packet, status: undefined }, registry)).toBeUndefined();
      manager.stop();
      await registry.close();
      registry = await DeviceRegistry.load(filePath);
      const restored = registry.findByTargetId(0x05010203);
      expect(restored).toMatchObject({
        sourceId: 0x05010203,
        profileId: 'F6-02-01',
        capabilities: ['rocker'],
        teachIn: { eep: 'F6-02-01', direction: 'unidirectional', responseExpected: false },
      });
      expect(restored?.reportedState).toBeUndefined();
      expect((await applyRadioPacket(packet, registry))?.device.reportedState).toEqual({
        messageType: 'N',
        pressed: true,
        buttons: ['AI', 'BI'],
      });
    } finally {
      manager.stop();
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  },
);

test('passive discoveries survive channel cancellation, are bounded, and can be dismissed', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-passive-candidates-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  try {
    const packet = { RORG: 0xf6, senderId: 0x05010203, payload: [0x10], status: 0x30 };
    manager.observe(packet);
    manager.observe(packet);
    expect(manager.listCandidates()).toHaveLength(1);
    manager.start();
    manager.stop();
    expect(manager.listCandidates()).toHaveLength(1);
    manager.reject(packet.senderId);
    expect(manager.listCandidates()).toEqual([]);
    for (let index = 0; index < 130; index += 1) {
      manager.observe({ ...packet, senderId: packet.senderId + index });
    }
    expect(manager.listCandidates()).toHaveLength(128);
    expect(manager.listCandidates()[0].targetId).toBe(packet.senderId + 2);
    const now = spyOn(Date, 'now').mockReturnValue(Date.now() + 300_001);
    try {
      expect(manager.listCandidates()).toEqual([]);
    } finally {
      now.mockRestore();
    }
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('persists ignored discoveries and allows discovery again after clearing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-ignored-discovery-'));
  const filePath = join(directory, 'configuration.yaml');
  let registry = await DeviceRegistry.load(filePath);
  let manager = new TeachInManager(registry, 0xffe76685);
  const packet = { RORG: 0xf6, senderId: 0x05010203, payload: [0x10], status: 0x30 };
  try {
    manager.observe(packet);
    await manager.ignore(packet.senderId);
    expect(manager.listCandidates()).toEqual([]);
    expect(manager.listIgnoredDevices()).toEqual([packet.senderId]);
    expect(manager.observe(packet)).toBeUndefined();
    expect(manager.accept(packet.senderId, 'F6-02-01')).rejects.toThrow('Device is ignored');
    const configuration = Bun.YAML.parse(await Bun.file(filePath).text()) as {
      ignoredDevices: string[];
    };
    expect(configuration.ignoredDevices).toEqual(['05010203']);
    manager.stop();
    await registry.close();
    registry = await DeviceRegistry.load(filePath);
    manager = new TeachInManager(registry, 0xffe76685);
    expect(manager.listIgnoredDevices()).toEqual([packet.senderId]);
    manager.start();
    expect(manager.observe(packet)).toBeUndefined();
    expect(
      manager.observe({
        RORG: 0xd4,
        senderId: packet.senderId,
        payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
      }),
    ).toBeUndefined();
    await manager.clearIgnored(packet.senderId);
    expect(manager.listIgnoredDevices()).toEqual([]);
    expect(manager.listCandidates()).toEqual([]);
    expect(manager.observe(packet)?.targetId).toBe(packet.senderId);
    manager.stop();
    await registry.close();
    registry = await DeviceRegistry.load(filePath);
    expect(registry.listIgnoredDevices()).toEqual([]);
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('does not allow acceptance during an ignore write and preserves discovery after failure', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-ignore-failure-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  const release = Promise.withResolvers<void>();
  const packet = { RORG: 0xf6, senderId: 0x05010203, payload: [0x10], status: 0x30 };
  const save = spyOn(registry, 'setDiscoveryIgnored').mockImplementationOnce(async () => {
    await release.promise;
    throw new Error('Cannot save ignore list');
  });
  try {
    manager.observe(packet);
    let notifications = 0;
    manager.onChange(() => {
      notifications += 1;
    });
    const pending = manager.ignore(packet.senderId).catch((error: Error) => error.message);
    expect(manager.observe(packet)).toBeUndefined();
    expect(manager.accept(packet.senderId, 'F6-02-01')).rejects.toThrow('Device is ignored');
    expect(manager.clearIgnored(packet.senderId)).rejects.toThrow('in progress');
    release.resolve();
    expect(await pending).toBe('Cannot save ignore list');
    expect(manager.listCandidates()).toHaveLength(1);
    expect(manager.listIgnoredDevices()).toEqual([]);
    expect(notifications).toBe(0);
    save.mockRestore();
    const acceptance = manager.accept(packet.senderId, 'F6-02-01');
    expect(manager.ignore(packet.senderId)).rejects.toThrow('acceptance is in progress');
    await acceptance;
  } finally {
    release.resolve();
    save.mockRestore();
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('reuses a legacy receive-only channel without changing its device identity', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-passive-reuse-'));
  const filePath = join(directory, 'configuration.yaml');
  let registry = await DeviceRegistry.load(filePath);
  const responses: number[] = [];
  let manager = new TeachInManager(registry, 0xffe76685, async (candidate) => {
    responses.push(candidate.sourceId);
  });
  try {
    await registry.upsert({
      sourceId: 0xffe76685,
      targetId: 0x05010203,
      name: 'Existing rocker',
      profileId: 'F6-02-01',
      capabilities: ['rocker'],
      availability: 'online',
    });
    const query = {
      RORG: 0xd4,
      senderId: 0x05010204,
      payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
    };
    expect(manager.observe(query)).toBeUndefined();
    manager.start();
    await manager.transmit(0xffe76685);
    expect(manager.observe(query)?.sourceId).toBe(0xffe76685);
    const fan = await manager.accept(query.senderId);
    expect(fan).toMatchObject({ sourceId: query.senderId, transmitId: 0xffe76685 });
    expect(responses).toEqual([0xffe76685]);
    expect(registry.findBySourceId(0xffe76685)).toMatchObject({
      name: 'Existing rocker',
      transmitId: null,
    });
    manager.stop();
    await registry.close();
    registry = await DeviceRegistry.load(filePath);
    manager = new TeachInManager(registry, 0xffe76685, async (candidate) => {
      responses.push(candidate.sourceId);
    });
    manager.start();
    expect(manager.observe(query)?.sourceId).toBeUndefined();
    expect(await manager.accept(query.senderId)).toMatchObject({
      sourceId: query.senderId,
      transmitId: 0xffe76685,
    });
    expect(responses).toEqual([0xffe76685, 0xffe76685]);
    expect(registry.findBySourceId(0xffe76685)?.name).toBe('Existing rocker');
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('ignores malformed RPS packets during pairing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-rocker-invalid-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76685);
  try {
    manager.start();
    for (const packet of [
      { payload: [0x10], status: undefined },
      { payload: [0x10], status: 0x10 },
      { payload: [], status: 0x30 },
      { payload: [0x10, 0], status: 0x30 },
      { payload: [0x90], status: 0x30 },
      { payload: [0x30], status: 0x20 },
    ]) {
      expect(manager.observe({ RORG: 0xf6, senderId: '05010203', ...packet })).toBeUndefined();
    }
    expect(manager.listCandidates()).toEqual([]);
  } finally {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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
    payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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
    payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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
    payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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
        payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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

test('requires profile confirmation for a correlated response without storing echoed manufacturer data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-teachin-auto-accept-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const manager = new TeachInManager(registry, 0xffe76681, undefined, undefined, async () => {});
  manager.start();
  await manager.transmit(0xffe76685);
  manager.observe({
    RORG: 0xd4,
    senderId: '05010208',
    destinationId: 'ffe76685',
    payload: [0x91, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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

  expect(registry.findByTargetId(0x05010208)).toBeUndefined();
  expect(manager.listCandidates()[0]).toMatchObject({
    eep: undefined,
    manufacturer: undefined,
    channel: undefined,
  });
  await manager.accept(0x05010208, 'D2-50-00');
  expect(registry.findByTargetId(0x05010208)?.sourceId).toBe(0xffe76685);
  expect(registry.findByTargetId(0x05010208)?.teachIn?.manufacturerId).toBeUndefined();
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
    payload: [0x80, 0xff, 0x0b, 0, 5, 2, 0xa5],
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
      payload: [0x80, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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
    payload: [0x80, 0xff, 0x61, 0, 0, 0x50, 0xd2],
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
    payload: [0x80, 0xff, 0x61, 0, 0, 0x50, 0xd2],
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
    payload: [0x40, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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
      payload: [0x90, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
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

describe('UTE acceptance safeguards', () => {
  let directory: string;
  let registry: DeviceRegistry;
  let manager: TeachInManager;
  let responses: string[];
  const query: RadioERP1Packet = {
    RORG: 0xd4,
    senderId: '05010203',
    payload: [0x80, 0xff, 0x61, 0, 0, 0x50, 0xd2],
  };
  const reply: RadioERP1Packet = {
    RORG: 0xd4,
    senderId: '05010203',
    destinationId: 'ffe76685',
    payload: [0x91, 0xff, 0x0b, 0, 0, 0x50, 0xd2],
  };

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'eep-ute-safeguards-'));
    registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
    responses = [];
    manager = new TeachInManager(
      registry,
      0xffe76685,
      async (candidate, response) => {
        if (response === 'teachInAccepted') {
          expect(registry.findByTargetId(candidate.targetId)?.profileId).toBe(candidate.eep);
        }
        responses.push(response);
      },
      undefined,
      async () => {},
    );
    manager.start();
  });

  afterEach(async () => {
    manager.stop();
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  });

  test('persists once before replying and ignores concurrent duplicate queries', async () => {
    const save = spyOn(registry, 'upsert');
    manager.observe(query);
    manager.observe(query);
    await manager.accept(0x05010203);
    expect(save).toHaveBeenCalledTimes(1);
    expect(responses).toEqual(['teachInAccepted']);
    expect(manager.listCandidates()).toEqual([]);
  });

  test('does not positively acknowledge a persistence failure', async () => {
    const save = spyOn(registry, 'upsert').mockRejectedValue(new Error('Disk unavailable'));
    const log = spyOn(console, 'error').mockImplementation(() => {});
    try {
      manager.observe(query);
      expect(await manager.accept(0x05010203).catch((error: Error) => error.message)).toBe(
        'Disk unavailable',
      );
      expect(responses).toEqual(['general']);
      expect(registry.findByTargetId(0x05010203)).toBeUndefined();
    } finally {
      save.mockRestore();
      log.mockRestore();
    }
  });

  test('does not reply or close a newer session after an in-flight save', async () => {
    const originalSave = registry.upsert.bind(registry);
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const save = spyOn(registry, 'upsert').mockImplementation(async (device) => {
      await blocked;
      return originalSave(device);
    });
    try {
      await manager.transmit(0xffe76685);
      manager.observe(query);
      const acceptance = manager.accept(0x05010203);
      manager.stop();
      manager.start();
      release();
      await acceptance;
      expect(manager.isActive()).toBe(true);
      expect(responses).toEqual([]);
    } finally {
      release();
      save.mockRestore();
    }
  });

  test('rejects unsolicited, unaddressed, mismatched and expired replies', async () => {
    expect(manager.observe(reply)).toBeUndefined();
    await manager.transmit(0xffe76685);
    for (const packet of [
      { ...reply, destinationId: undefined },
      { ...reply, destinationId: 'ffe76686' },
      { ...reply, payload: [0x91, 1, 0x0b, 0, 0, 0x50, 0xd2] },
      { ...reply, payload: [0x91, 0xff, 0x61, 0, 0, 0x50, 0xd2] },
      { ...reply, payload: [0x11, 0xff, 0x0b, 0, 0, 0x50, 0xd2] },
      { ...reply, payload: [0x91, 0xff, 0x0b, 0, 1, 0, 0xd5] },
    ])
      expect(manager.observe(packet)).toBeUndefined();
    const now = Date.now();
    const clock = spyOn(Date, 'now').mockReturnValue(now + 701);
    try {
      expect(manager.observe(reply)).toBeUndefined();
      expect(manager.listCandidates()).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });

  test('does not send a response after the 500 ms receiver deadline', async () => {
    const originalSave = registry.upsert.bind(registry);
    const now = Date.now();
    const clock = spyOn(Date, 'now').mockReturnValue(now);
    const save = spyOn(registry, 'upsert').mockImplementation(async (device) => {
      const accepted = await originalSave(device);
      clock.mockReturnValue(now + 501);
      return accepted;
    });
    try {
      manager.observe(query);
      await manager.accept(0x05010203);
      expect(responses).toEqual([]);
    } finally {
      save.mockRestore();
      clock.mockRestore();
    }
  });

  test('rejects addressed queries for another channel and conflicting re-teach profiles', () => {
    expect(manager.observe({ ...query, destinationId: 'ffe76686' })).toBeUndefined();
    expect(
      manager.observe({
        ...query,
        senderId: '0513cefe',
        payload: [0x80, 0xff, 0x61, 0, 1, 0, 0xd5],
      }),
    ).toBeUndefined();
    expect(registry.findByTargetId(0x0513cefe)?.profileId).toBe('D2-50-00');
    expect(responses).toEqual(['general']);
  });

  test('candidate snapshots cannot bypass explicit profile selection', async () => {
    const candidate = manager.observe({ RORG: 0xd5, senderId: '05010203', payload: [0] })!;
    candidate.eep = 'D2-50-00';
    manager.listCandidates()[0].eep = 'D2-50-00';
    expect(await manager.accept(0x05010203).catch((error: Error) => error.message)).toBe(
      'Select an EEP for this teach-in candidate',
    );
    manager.stop();
    expect(
      await manager.accept(0x05010203, 'D2-50-00').catch((error: Error) => error.message),
    ).toBe('EEP does not match the teach-in telegram');
    expect(await manager.accept(0x05010203, 'D5-00-01')).toMatchObject({ transmitId: null });
  });
});
