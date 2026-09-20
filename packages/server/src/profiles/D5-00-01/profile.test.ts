import { expect, test } from 'bun:test';
import { createDefaultProfileRegistry } from '../index';
import { d5Profile } from './profile';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05010203,
  capabilities: d5Profile.defaultCapabilities(),
};

test('only the learn and contact bits affect all 256 valid one-byte telegrams', () => {
  for (let data = 0; data <= 0xff; data += 1) {
    const result = d5Profile.decodeIngress(context, {
      RORG: 0xd5,
      senderId: context.targetId,
      payload: Uint8Array.of(data),
    });
    expect(result).toEqual(
      (data & 0x08) === 0
        ? { kind: 'ignored' }
        : {
            kind: 'reported',
            value: (data & 1) === 0,
            reportedState: { open: (data & 1) === 0 },
            clearDesiredState: true,
          },
    );
  }
});

test('registers D5-00-01 as a receive-only contact sensor', () => {
  expect(createDefaultProfileRegistry().require('d5-00-01')).toBe(d5Profile);
  expect(d5Profile.entity?.describe(context)).toMatchObject({
    kind: 'binary_sensor',
    power: false,
    commands: [],
  });
});

test.each([
  { data: 0x08, open: true },
  { data: 0x09, open: false },
  { data: 0xfe, open: true },
  { data: 0xff, open: false },
])('decodes contact state from DB0.0 in $data', ({ data, open }) => {
  expect(
    d5Profile.decodeIngress(context, {
      RORG: 0xd5,
      senderId: context.targetId,
      payload: [data],
    }),
  ).toEqual({
    kind: 'reported',
    value: open,
    reportedState: { open },
    clearDesiredState: true,
  });
  expect(d5Profile.entity?.projectState({ ...context, reportedState: { open } })).toEqual({
    isOn: open,
  });
});

test.each([
  { payload: [] },
  { payload: [0x08, 0x09] },
  { payload: [0x00] },
  { payload: [0x01] },
  { payload: [0xf6] },
  { payload: [0xf7] },
  { payload: [-1] },
  { payload: [0x108] },
  { payload: [8.5] },
  { payload: [Number.NaN] },
])('ignores learn telegrams and malformed payloads: $payload', ({ payload }) => {
  expect(
    d5Profile.decodeIngress(context, { RORG: 0xd5, senderId: context.targetId, payload }),
  ).toEqual({ kind: 'ignored' });
});

test('ignores other RORGs and explicitly marked teach-in packets', () => {
  const packet = { RORG: 0xd5, senderId: context.targetId, payload: [0x08] };
  expect(d5Profile.decodeIngress(context, { ...packet, RORG: 0xd2 })).toEqual({
    kind: 'ignored',
  });
  expect(d5Profile.decodeIngress(context, { ...packet, teachIn: true })).toEqual({
    kind: 'ignored',
  });
});

test('validates persisted contact capabilities and state', () => {
  expect(d5Profile.validateCapabilities(['contact'])).toEqual(['contact']);
  expect(d5Profile.validateState({ open: false }, 'reportedState', context.capabilities)).toEqual({
    open: false,
  });
  expect(() => d5Profile.validateCapabilities([])).toThrow('Invalid D5-00-01 capabilities');
  expect(() => d5Profile.validateCapabilities(['contact', 'contact'])).toThrow();
  expect(() =>
    d5Profile.validateState({ open: 1 }, 'reportedState', context.capabilities),
  ).toThrow();
  expect(() => d5Profile.validateState(null, 'reportedState', context.capabilities)).toThrow();
});

test('rejects commands and desired state for a receive-only sensor', () => {
  expect(() => d5Profile.parseCommand(context, { open: true })).toThrow('read-only');
  expect(() => d5Profile.encodeCommand(context, { value: true })).toThrow('read-only');
  expect(() => d5Profile.entity?.parseCommand(context, 'command', 'ON')).toThrow('read-only');
  expect(() =>
    d5Profile.validateState({ open: true }, 'desiredState', context.capabilities),
  ).toThrow('read-only');
});
