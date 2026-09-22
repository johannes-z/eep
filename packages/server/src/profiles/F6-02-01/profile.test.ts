import { expect, test } from 'bun:test';
import { createDefaultProfileRegistry } from '../index';
import { f6Profile } from './profile';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05010203,
  capabilities: f6Profile.defaultCapabilities(),
};

function decode(data: number, status = 0x30) {
  return f6Profile.decodeIngress(context, {
    RORG: 0xf6,
    senderId: context.targetId,
    payload: [data],
    status,
  });
}

test('registers F6-02-01 as a receive-only rocker switch', () => {
  expect(createDefaultProfileRegistry().require('f6-02-01')).toBe(f6Profile);
  expect(f6Profile.entity?.describe(context)).toMatchObject({
    kind: 'binary_sensor',
    power: false,
    commands: [],
  });
  expect(f6Profile.entity?.projectState(context)).toEqual({ isOn: false });
});

test('exposes four initially off momentary sensors with transient reports', () => {
  const descriptor = f6Profile.entity!.describe(context);
  expect(descriptor.publishInitialState).toBe(true);
  expect(f6Profile.transientReportedState).toBe(true);
  expect(descriptor.discoveryEntities).toEqual(
    ['AI', 'A0', 'BI', 'B0'].map((button) => ({
      key: button.toLowerCase(),
      name: button,
      valueTemplate: `{{ 'ON' if value_json.messageType | default('') == 'N' and value_json.pressed | default(false) and '${button}' in value_json.buttons | default([]) else 'OFF' }}`,
    })),
  );
});

test.each([
  { data: 0x10, button: 'AI' },
  { data: 0x30, button: 'A0' },
  { data: 0x50, button: 'BI' },
  { data: 0x70, button: 'B0' },
])('decodes Application Style 1 button $button', ({ data, button }) => {
  for (const pressed of [false, true]) {
    const state = { messageType: 'N', pressed, buttons: [button] };
    expect(decode(pressed ? data : data & ~0x10)).toEqual({
      kind: 'reported',
      value: state,
      reportedState: state,
      clearDesiredState: true,
    });
    expect(f6Profile.entity?.projectState({ ...context, reportedState: state })).toEqual({
      isOn: pressed,
      attributes: state,
    });
  }
});

test('decodes every valid pair of actions and ignores R2 when SA is clear', () => {
  const buttons = ['AI', 'A0', 'BI', 'B0'];
  for (let firstAction = 0; firstAction < 4; firstAction += 1) {
    for (let secondAction = 0; secondAction < 8; secondAction += 1) {
      const data = (firstAction << 5) | 0x10 | (secondAction << 1);
      expect(decode(data)).toMatchObject({
        kind: 'reported',
        reportedState: { messageType: 'N', pressed: true, buttons: [buttons[firstAction]] },
      });
      expect(decode(data | 1)).toMatchObject(
        secondAction < 4
          ? {
              kind: 'reported',
              reportedState: {
                messageType: 'N',
                pressed: true,
                buttons: [buttons[firstAction], buttons[secondAction]],
              },
            }
          : { kind: 'ignored' },
      );
    }
  }
});

test('validates all 256 N-message and U-message data bytes', () => {
  for (let data = 0; data <= 0xff; data += 1) {
    const firstAction = data >> 5;
    const secondAction = (data >> 1) & 7;
    const validNormal = firstAction < 4 && ((data & 1) === 0 || secondAction < 4);
    const validUnassigned = [0x00, 0x10, 0x60, 0x70].includes(data);
    expect(decode(data, 0x30).kind).toBe(validNormal ? 'reported' : 'ignored');
    expect(decode(data, 0x20).kind).toBe(validUnassigned ? 'reported' : 'ignored');
  }
});

test.each([
  { data: 0x00, pressed: false, buttonCount: 0 },
  { data: 0x10, pressed: true, buttonCount: 0 },
  { data: 0x60, pressed: false, buttonCount: '3_or_4' },
  { data: 0x70, pressed: true, buttonCount: '3_or_4' },
])(
  'decodes U-message $data without inventing button identities',
  ({ data, pressed, buttonCount }) => {
    const state = { messageType: 'U', pressed, buttonCount };
    expect(decode(data, 0x20)).toEqual({
      kind: 'reported',
      value: state,
      reportedState: state,
      clearDesiredState: true,
    });
    expect(f6Profile.validateState(state, 'reportedState', context.capabilities)).toEqual(state);
    expect(f6Profile.entity?.projectState({ ...context, reportedState: state })).toEqual({
      isOn: pressed,
      attributes: state,
    });
  },
);

test('requires T21, uses NU for message type, and ignores unrelated status bits', () => {
  for (let status = 0; status <= 0xff; status += 1) {
    const result = decode(0x70, status);
    if ((status & 0x20) === 0) {
      expect(result).toEqual({ kind: 'ignored' });
    } else {
      expect(result).toMatchObject({
        kind: 'reported',
        reportedState:
          (status & 0x10) !== 0
            ? { messageType: 'N', pressed: true, buttons: ['B0'] }
            : { messageType: 'U', pressed: true, buttonCount: '3_or_4' },
      });
    }
  }
});

test.each([undefined, -1, 256, 1.5, Number.NaN])(
  'ignores missing or malformed status %s',
  (status) => {
    expect(
      f6Profile.decodeIngress(context, {
        RORG: 0xf6,
        senderId: context.targetId,
        payload: [0x10],
        status,
      }),
    ).toEqual({ kind: 'ignored' });
  },
);

test.each([
  { payload: [] },
  { payload: [0x10, 0] },
  { payload: [-1] },
  { payload: [256] },
  { payload: [16.5] },
  { payload: [Number.NaN] },
])('ignores malformed payload $payload', ({ payload }) => {
  expect(
    f6Profile.decodeIngress(context, {
      RORG: 0xf6,
      senderId: context.targetId,
      payload,
      status: 0x30,
    }),
  ).toEqual({ kind: 'ignored' });
});

test('ignores other RORGs and explicitly marked teach-in packets', () => {
  const packet = { RORG: 0xf6, senderId: context.targetId, payload: [0x10], status: 0x30 };
  expect(f6Profile.decodeIngress(context, { ...packet, RORG: 0xd5 })).toEqual({ kind: 'ignored' });
  expect(f6Profile.decodeIngress(context, { ...packet, teachIn: true })).toEqual({
    kind: 'ignored',
  });
});

test('validates and detaches persisted rocker capabilities and state', () => {
  expect(f6Profile.validateCapabilities(['rocker'])).toEqual(['rocker']);
  const state = { messageType: 'N', pressed: true, buttons: ['AI', 'BI'] };
  const validated = f6Profile.validateState(state, 'reportedState', context.capabilities);
  state.buttons.push('B0');
  expect(validated).toEqual({ messageType: 'N', pressed: true, buttons: ['AI', 'BI'] });
  for (const invalid of [undefined, [], ['contact'], ['rocker', 'rocker']]) {
    expect(() => f6Profile.validateCapabilities(invalid)).toThrow('Invalid F6-02-01 capabilities');
  }
});

test.each([
  { state: null },
  { state: [] },
  { state: {} },
  { state: { messageType: 'N', pressed: 1, buttons: ['AI'] } },
  { state: { messageType: 'N', pressed: true, buttons: [] } },
  { state: { messageType: 'N', pressed: true, buttons: ['AI', 'A0', 'BI'] } },
  { state: { messageType: 'N', pressed: true, buttons: ['invalid'] } },
  { state: { messageType: 'U', pressed: false, buttonCount: 3 } },
  { state: { messageType: 'U', pressed: false, buttons: ['AI'] } },
  { state: { messageType: 'other', pressed: false, buttonCount: 0 } },
])('rejects malformed persisted state $state', ({ state }) => {
  expect(() => f6Profile.validateState(state, 'reportedState', context.capabilities)).toThrow();
});

test('rejects outgoing commands and desired state', () => {
  expect(() => f6Profile.parseCommand(context, { pressed: true })).toThrow('read-only');
  expect(() => f6Profile.encodeCommand(context, { value: true })).toThrow('read-only');
  expect(() => f6Profile.entity?.parseCommand(context, 'command', 'ON')).toThrow('read-only');
  expect(() => f6Profile.validateState({}, 'desiredState', context.capabilities)).toThrow(
    'read-only',
  );
});
