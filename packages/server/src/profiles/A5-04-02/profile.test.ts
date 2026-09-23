import { expect, test } from 'bun:test';
import { a5TemperatureHumidityExtendedProfile } from './profile';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05010203,
  capabilities: a5TemperatureHumidityExtendedProfile.defaultCapabilities(),
};
const packet = (payload: number[]) => ({ RORG: 0xa5, senderId: context.targetId, payload });
const decode = (payload: number[]) =>
  a5TemperatureHumidityExtendedProfile.decodeIngress(context, packet(payload));

test('decodes A5-04-02 temperature and humidity values', () => {
  expect(decode([0, 125, 125, 8])).toEqual({
    kind: 'reported',
    value: { temperature: 20, humidity: 50 },
    reportedState: { temperature: 20, humidity: 50 },
    clearDesiredState: true,
  });
  expect(decode([0, 250, 0, 8])).toMatchObject({
    reportedState: { temperature: -20, humidity: 100 },
  });
  expect(decode([0, 0, 250, 8])).toMatchObject({
    reportedState: { temperature: 60, humidity: 0 },
  });
});

test('rejects teach-in, reserved values, wrong RORG, and malformed payloads', () => {
  for (const candidate of [
    { RORG: 0xa5, senderId: context.targetId, teachIn: true, payload: [0, 125, 125, 0] },
    { RORG: 0xa5, senderId: context.targetId, payload: [0, 251, 125, 8] },
    { RORG: 0xa5, senderId: context.targetId, payload: [0, 125, 251, 8] },
    { RORG: 0xa5, senderId: context.targetId, payload: [1, 125, 125, 8] },
    { RORG: 0xd2, senderId: context.targetId, payload: [0, 125, 125, 8] },
    { RORG: 0xa5, senderId: context.targetId, payload: [0, 125, 125] },
  ]) {
    expect(a5TemperatureHumidityExtendedProfile.decodeIngress(context, candidate)).toEqual({
      kind: 'ignored',
    });
  }
  expect(decode([0, 125, 125, 0])).toEqual({ kind: 'ignored' });
});

test('exposes read-only extended temperature and humidity state', () => {
  expect(a5TemperatureHumidityExtendedProfile.defaultCapabilities()).toEqual([
    'temperature',
    'humidity',
  ]);
  expect(() => a5TemperatureHumidityExtendedProfile.parseCommand(context, {})).toThrow('read-only');
  expect(() =>
    a5TemperatureHumidityExtendedProfile.validateState(
      { temperature: 20, humidity: 50 },
      'desiredState',
      context.capabilities,
    ),
  ).toThrow('read-only');
  expect(
    a5TemperatureHumidityExtendedProfile.entity?.projectState({
      ...context,
      reportedState: { temperature: 20, humidity: 50 },
    }),
  ).toEqual({ isOn: true, attributes: { temperature: 20, humidity: 50 } });
});
