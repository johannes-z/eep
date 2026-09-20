import { expect, test } from 'bun:test';
import { d2Profile } from './profile';
import { Esp3Parser } from '../../transport/esp3';
import { changeState } from './changeState';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05126787,
  capabilities: d2Profile.defaultCapabilities(),
};

test.each(['toString', 'constructor', '__proto__'])(
  'rejects inherited capability name %s',
  (capability) => {
    expect(() => d2Profile.validateCapabilities([capability])).toThrow(
      'Invalid D2-50-00 capabilities',
    );
  },
);

test.each(['', ' ', '\n'])('rejects blank commands %j', (value) => {
  expect(() => d2Profile.parseCommand(context, { value })).toThrow();
  expect(() => d2Profile.entity?.parseCommand(context, 'percentage', value)).toThrow();
});

test('decodes D2-50-00 basic status modes through the profile contract', () => {
  expect(
    d2Profile.decodeIngress(context, {
      RORG: 0xd2,
      payload: [0x41, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0],
      senderId: '05126787',
    }),
  ).toMatchObject({
    kind: 'reported',
    reportedState: { d2Value: 1, isOn: true, percentage: 25 },
    clearDesiredState: true,
  });
  expect(
    d2Profile.decodeIngress(context, {
      RORG: 0xd2,
      payload: [0x4b, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0],
      senderId: '05126787',
    }),
  ).toMatchObject({ kind: 'reported', reportedState: { d2Value: 11, preset: 'Automatic' } });
  expect(
    d2Profile.decodeIngress(context, {
      RORG: 0xd2,
      payload: [0x60, 0xd8, 0x57, 0x48, 0x00, 0x00],
      senderId: '05126787',
    }),
  ).toEqual({ kind: 'ignored' });
});

test('parses a command and encodes the D2 ERP1 frame through the profile contract', () => {
  const command = d2Profile.parseCommand(context, { percentage: 75 });
  const frame = d2Profile.encodeCommand(context, command);

  expect(command).toMatchObject({ value: 3, desiredState: { d2Value: 3, percentage: 75 } });
  expect(Array.from(frame.slice(6, 13))).toEqual([0xd2, 0x23, 0, 0x7f, 0x7f, 0x7f, 0]);
});

test('uses the assigned device source ID when addressing a command', () => {
  const commandContext = {
    ...context,
    sourceId: 0xffe76682,
  };
  const command = d2Profile.parseCommand(commandContext, { percentage: 75 });
  const frame = d2Profile.encodeCommand(commandContext, command);

  expect(Array.from(frame.slice(13, 17))).toEqual([0xff, 0xe7, 0x66, 0x82]);
  expect(Array.from(frame.slice(19, 23))).toEqual([0x05, 0x12, 0x67, 0x87]);
});

test.each([0, 1, 2, 3, 4, 11, 12, 13, 14, 15])(
  'encodes a valid control telegram for mode %s',
  (value) => {
    const device = {
      ...context,
      capabilities: [...(context.capabilities as string[]), 'automaticOnDemand'],
    };
    const command = d2Profile.parseCommand(device, { value });
    const frames = new Esp3Parser().push(d2Profile.encodeCommand(device, command));
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toEqual([
      0xd2,
      0x20 | value,
      0,
      0x7f,
      0x7f,
      0x7f,
      0,
      0xff,
      0xe7,
      0x66,
      0x81,
      0,
    ]);
    expect(frames[0].optionalData).toEqual([3, 5, 0x12, 0x67, 0x87, 0xff, 0]);
    if (value === 15) expect(command.desiredState).toBeUndefined();
  },
);

test('rejects invalid control values and address bytes', () => {
  for (const value of [5, 10, 16, -1, 1.5, Number.NaN]) {
    expect(() => changeState([1, 2, 3, 4], [5, 6, 7, 8], value)).toThrow('Unsupported');
  }
  expect(() => changeState([1, 2, 3, 256], [5, 6, 7, 8], 1)).toThrow('valid bytes');
});

test('ignores requests, controls, truncated status and reserved modes', () => {
  for (const payload of [
    [],
    [0],
    [1],
    [0xd1],
    [0x23, 0, 0x7f, 0x7f, 0x7f, 0],
    [0x41, 0x03, 0, 0x1e, 0, 0xc3],
    [0x45, ...Array(13).fill(0)],
    [0x4f, ...Array(13).fill(0)],
    [0x41, ...Array(13).fill(256)],
    [0x41, ...Array(14).fill(0)],
  ]) {
    expect(
      d2Profile.decodeIngress(context, { RORG: 0xd2, senderId: context.targetId, payload }),
    ).toEqual({ kind: 'ignored' });
  }
});

test('accepts reported modes independently of enabled commands and ignores reserved bits', () => {
  const device = { ...context, capabilities: ['off', 'level1'] };
  const result = d2Profile.decodeIngress(device, {
    RORG: 0xd2,
    senderId: context.targetId,
    payload: [0x5b, ...Array(13).fill(0)],
  });
  expect(result).toMatchObject({
    kind: 'reported',
    reportedState: { d2Value: 11, preset: 'Automatic' },
  });
  if (result.kind !== 'reported') throw new Error('Expected status');
  expect(() =>
    d2Profile.validateState(result.reportedState, 'reportedState', device.capabilities),
  ).not.toThrow();
  expect(() => d2Profile.parseCommand(device, { value: 11 })).toThrow('does not support');
});
