import { expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeviceRegistry } from './registry';
import { applyRadioPacket } from './inbound';
import { decodeD2Value } from '../profiles/D2-50-00/profile';
import { a5Profile } from '../profiles';
import { replyToRadioPacket, sendDeviceCommand } from './commands';
import { Esp3Parser } from '../transport/esp3';

test('queues actuator commands, replies on wake, persists settings, and does not repeat reference-run', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-actuator-inbound-'));
  const filePath = join(directory, 'configuration.yaml');
  let registry = await DeviceRegistry.load(filePath);
  const writes: number[][] = [];
  const socket = {
    write: (payload: Uint8Array) => {
      writes.push(new Esp3Parser().push(payload)[0].data);
    },
  };
  const packet = { RORG: 0xa5, senderId: 0x05010203, payload: [22, 0xaa, 40, 0x68] };
  try {
    const device = await registry.upsert({
      sourceId: 0xffe76685,
      transmitId: 0xffe76686,
      targetId: packet.senderId,
      name: 'Heating',
      profileId: 'A5-20-06',
      capabilities: a5Profile.defaultCapabilities(),
      availability: 'unknown',
    });
    await sendDeviceCommand(socket, registry, device, { setpoint: 24, referenceRun: true });
    expect(writes).toEqual([]);
    await replyToRadioPacket(socket, registry, { ...packet, destinationId: 0xffe76685 });
    expect(writes).toEqual([]);
    await replyToRadioPacket(socket, registry, packet);
    expect(writes[0]).toEqual([0xa5, 48, 255, 0x84, 8, 0xff, 0xe7, 0x66, 0x86, 0]);
    await applyRadioPacket(packet, registry);
    expect(registry.findBySourceId(device.sourceId)).toMatchObject({
      reportedState: { valvePosition: 22, temperature: 20 },
      desiredState: { setpoint: 24, referenceRun: false },
    });
    await replyToRadioPacket(socket, registry, packet);
    expect(writes[1][3]).toBe(4);
    await replyToRadioPacket(socket, registry, { ...packet, payload: [0x80, 0x30, 0x49, 0x80] });
    expect(writes).toHaveLength(2);
    await sendDeviceCommand(socket, registry, registry.findBySourceId(device.sourceId)!, {
      mode: 'valvePosition',
      setpoint: 0,
    });
    await registry.close();
    registry = await DeviceRegistry.load(filePath);
    expect(registry.findBySourceId(device.sourceId)).toMatchObject({
      desiredState: { setpoint: 0, temperatureSetpoint: 24, referenceRun: false },
    });
    const restored = registry.findBySourceId(device.sourceId)!;
    await sendDeviceCommand(
      socket,
      registry,
      restored,
      a5Profile.entity!.parseCommand(restored, 'mode', 'heat'),
    );
    expect(writes).toHaveLength(2);
    expect(registry.findBySourceId(device.sourceId)).toMatchObject({
      desiredState: { mode: 'temperature', setpoint: 24, temperatureSetpoint: 24 },
    });
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test('failed actuator replies retain pending actions and successful replies cannot overwrite newer commands', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'eep-actuator-race-'));
  const registry = await DeviceRegistry.load(join(directory, 'configuration.yaml'));
  const packet = { RORG: 0xa5, senderId: 0x05010203, payload: [22, 0xaa, 40, 0x68] };
  try {
    const device = await registry.upsert({
      sourceId: 0xffe76685,
      targetId: packet.senderId,
      name: 'Heating',
      profileId: 'A5-20-06',
      capabilities: a5Profile.defaultCapabilities(),
      availability: 'unknown',
    });
    const socket = {
      write: () => {
        throw new Error('Disconnected');
      },
    };
    await sendDeviceCommand(socket, registry, device, { setpoint: 24, referenceRun: true });
    expect(replyToRadioPacket(socket, registry, packet)).rejects.toThrow('Disconnected');
    expect(registry.findBySourceId(device.sourceId)?.desiredState).toMatchObject({
      referenceRun: true,
    });
    await replyToRadioPacket(
      {
        write: async () => {
          await sendDeviceCommand(socket, registry, registry.findBySourceId(device.sourceId)!, {
            setpoint: 25,
          });
        },
      },
      registry,
      packet,
    );
    expect(registry.findBySourceId(device.sourceId)?.desiredState).toMatchObject({
      setpoint: 25,
      referenceRun: true,
    });
  } finally {
    await registry.close();
    await rm(directory, { recursive: true, force: true });
  }
});

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
