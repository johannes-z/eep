import { expect, test } from 'bun:test';
import { a5Profile } from './profile';
import { Esp3Parser, parseRadioERP1 } from '../../transport/esp3';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05010203,
  capabilities: a5Profile.defaultCapabilities(),
};
const packet = (payload: number[]) => ({ RORG: 0xa5, senderId: context.targetId, payload });
const decode = (payload: number[]) => a5Profile.decodeIngress(context, packet(payload));

test('decodes the Micropelt status example and every diagnostic bit', () => {
  expect(decode([0x16, 0xaa, 0x6e, 0xe8])).toMatchObject({
    kind: 'reported',
    clearDesiredState: false,
    reportedState: {
      valvePosition: 22,
      localOffsetMode: 'absolute',
      localOffset: 21,
      temperature: 55,
      temperatureSensor: 'flow',
      temperatureError: false,
      harvesting: true,
      energyStorageLow: false,
      windowOpen: false,
      radioError: false,
      signalWeak: false,
      actuatorObstructed: false,
    },
  });
  expect(decode([100, 0x7b, 40, 0x1f])).toMatchObject({
    reportedState: {
      localOffset: -5,
      temperature: 20,
      temperatureSensor: 'ambient',
      harvesting: false,
      energyStorageLow: true,
      windowOpen: true,
      radioError: true,
      signalWeak: true,
      actuatorObstructed: true,
    },
  });
  for (const offset of [0, 1, 5, 123, 127]) {
    expect(decode([0, offset, 80, 8])).toMatchObject({
      reportedState: { localOffset: offset > 5 ? offset - 128 : offset },
    });
  }
});

test('handles reserved readings and sensor faults without losing diagnostics', () => {
  expect(decode([101, 6, 81, 8])).toMatchObject({
    reportedState: {
      valvePosition: null,
      localOffset: null,
      temperature: null,
      temperatureError: false,
    },
  });
  expect(decode([0, 0xd1, 255, 8])).toMatchObject({
    reportedState: { localOffset: null, temperature: null, temperatureError: true },
  });
  expect(decode([0, 0xd0, 160, 0x88])).toMatchObject({
    reportedState: { localOffset: 40, temperature: 80 },
  });
  for (const payload of [
    [0x80, 0x30, 0x49, 0x80],
    [1, 2, 3],
    [1, 2, 256, 8],
  ]) {
    expect(decode(payload)).toEqual({ kind: 'ignored' });
  }
  expect(a5Profile.decodeIngress(context, { ...packet([0, 0, 0, 8]), RORG: 0xd2 })).toEqual({
    kind: 'ignored',
  });
});

test('encodes the Micropelt command example in a checksummed addressed ERP1 frame', () => {
  const command = a5Profile.parseCommand(context, {
    mode: 'temperature',
    setpoint: 24,
    roomTemperature: 26,
    communicationInterval: 20,
  });
  const frames = new Esp3Parser().push(a5Profile.encodeCommand(context, command));
  expect(frames).toHaveLength(1);
  expect(parseRadioERP1(frames[0])).toMatchObject({
    RORG: 0xa5,
    payload: [0x30, 0x68, 0x44, 8],
    senderId: 'ffe76681',
    destinationId: '05010203',
    teachIn: false,
  });
});

test('encodes every interval and control bit with correct resolutions', () => {
  for (const [index, interval] of [0, 2, 5, 10, 20, 30, 60, 120].entries()) {
    const command = a5Profile.parseCommand(context, {
      mode: 'valvePosition',
      setpoint: 100,
      roomTemperature: 0.25,
      referenceRun: true,
      communicationInterval: interval,
      summerMode: true,
      temperatureSensor: 'flow',
      standby: true,
    });
    const frame = new Esp3Parser().push(a5Profile.encodeCommand(context, command))[0];
    expect(frame.data.slice(1, 5)).toEqual([100, 1, 0x8b | (index << 4), 8]);
  }
  const command = a5Profile.parseCommand(context, { setpoint: 20.5 });
  expect(
    new Esp3Parser().push(a5Profile.encodeCommand(context, command))[0].data.slice(1, 5),
  ).toEqual([41, 255, 4, 8]);
});

test('rejects invalid commands and malformed persisted settings', () => {
  for (const request of [
    {},
    { setpoint: 40.5 },
    { setpoint: -1 },
    { setpoint: 20.25 },
    { setpoint: NaN },
    { mode: 'invalid' },
    { mode: 'valvePosition' },
    { mode: 'valvePosition', setpoint: 101 },
    { roomTemperature: 0 },
    { roomTemperature: 40.25 },
    { roomTemperature: 20.1 },
    { communicationInterval: 3 },
    { standby: 1 },
    { temperatureSetpoint: 40.5 },
    { extra: true },
  ])
    expect(() => a5Profile.parseCommand(context, request)).toThrow();
  expect(() => a5Profile.validateState({}, 'desiredState', context.capabilities)).toThrow();
});

test('replies on every wake, preserves desired settings and clears only the reference-run pulse', () => {
  const status = packet([22, 0xaa, 40, 0x68]);
  const initial = a5Profile.replyOnReceive!(context, status)!;
  expect(initial.desiredState).toMatchObject({
    mode: 'temperature',
    setpoint: 21,
    referenceRun: false,
  });
  const command = a5Profile.parseCommand(context, { setpoint: 24, referenceRun: true });
  const reply = a5Profile.replyOnReceive!(
    { ...context, desiredState: command.desiredState },
    status,
  )!;
  expect(reply.value).toMatchObject({ setpoint: 24, referenceRun: true });
  expect(reply.desiredState).toMatchObject({ setpoint: 24, referenceRun: false });
  expect(a5Profile.replyOnReceive!(context, packet([0x80, 0x30, 0x49, 0x80]))).toBeUndefined();
  expect(a5Profile.replyOnReceive!(context, packet([35, 2, 40, 8]))?.value).toMatchObject({
    mode: 'valvePosition',
    setpoint: 35,
  });
});

test('projects MQTT state without confusing flow temperature with room temperature', () => {
  const result = decode([22, 0xaa, 110, 0xe8]);
  if (result.kind !== 'reported') throw new Error('Expected status');
  const entity = a5Profile.entity!;
  expect(
    entity.projectState({ ...context, reportedState: result.reportedState }).attributes,
  ).toMatchObject({
    currentTemperature: null,
    targetTemperature: 21,
    temperature: 55,
    valvePosition: 22,
  });
  expect(entity.parseCommand(context, 'temperature', '22.5')).toMatchObject({ setpoint: 22.5 });
  expect(
    entity.parseCommand(context, 'command', '{"mode":"valvePosition","setpoint":45}'),
  ).toMatchObject({ setpoint: 45 });
});

test('keeps a temperature target before first reception and across valve control and off', () => {
  const entity = a5Profile.entity!;
  expect(entity.describe(context).publishInitialState).toBe(true);
  expect(entity.projectState(context).attributes).toMatchObject({
    currentTemperature: null,
    valvePosition: null,
    targetTemperature: 21,
    hvacMode: 'off',
  });
  const temperature = a5Profile.parseCommand(context, { setpoint: 23.5 });
  const temperatureContext = { ...context, desiredState: temperature.desiredState };
  for (const setpoint of [0, 45]) {
    const valve = a5Profile.parseCommand(temperatureContext, { mode: 'valvePosition', setpoint });
    const valveContext = { ...context, desiredState: valve.desiredState };
    expect(entity.projectState(valveContext).attributes).toMatchObject({
      mode: 'valvePosition',
      setpoint,
      targetTemperature: 23.5,
      hvacMode: 'off',
      currentTemperature: null,
    });
    expect(entity.parseCommand(valveContext, 'mode', 'heat')).toMatchObject({
      mode: 'temperature',
      setpoint: 23.5,
      standby: false,
      summerMode: false,
    });
    expect(
      new Esp3Parser().push(a5Profile.encodeCommand(valveContext, valve))[0].data.slice(1, 5),
    ).toEqual([setpoint, 255, 0, 8]);
  }
  const { temperatureSetpoint: _previousTarget, ...legacy } = temperature.desiredState as Record<
    string,
    unknown
  >;
  expect(a5Profile.validateState(legacy, 'desiredState', context.capabilities)).toMatchObject({
    temperatureSetpoint: 23.5,
  });
  expect(
    a5Profile.validateState(
      { ...legacy, mode: 'valvePosition', setpoint: 70 },
      'desiredState',
      context.capabilities,
    ),
  ).toMatchObject({ mode: 'valvePosition', setpoint: 70, temperatureSetpoint: 21 });
});
