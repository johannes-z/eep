import { expect, test } from 'bun:test';
import { d2Profile } from './profile';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05126787,
  capabilities: d2Profile.defaultCapabilities(),
};

test('decodes D2-50-00 basic status modes through the profile contract', () => {
  expect(
    d2Profile.decodeIngress(context, {
      RORG: 0xd2,
      payload: [0x41, 0x03, 0x00, 0x1e, 0x00, 0xc3],
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
      payload: [0x4b, 0x03, 0x00, 0x1e, 0x00, 0xc3],
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
  expect(Array.from(frame.slice(6, 13))).toEqual([0xd2, 3, 0, 0, 0, 0, 0]);
});
