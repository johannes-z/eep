import { expect, test } from 'bun:test';
import { diagnosticValues } from './device';

test('publishes sender ID, target ID, and EEP diagnostics', () => {
  expect(
    diagnosticValues({
      sourceId: 0xffe76681,
      targetId: 0x0513cefe,
      name: 'Living Room vent',
      profileId: 'D2-50-00',
      capabilities: [],
      availability: 'online',
    }),
  ).toEqual([
    { field: 'sender_id', name: 'Sender ID', value: '0513cefe' },
    { field: 'target_id', name: 'Target ID', value: 'ffe76681' },
    { field: 'eep', name: 'EEP', value: 'D2-50-00' },
  ]);
});

test('does not report a transmit channel for receive-only devices', () => {
  expect(
    diagnosticValues({
      sourceId: 0xffe76685,
      transmitId: null,
      targetId: 0x05010203,
      name: 'Rocker',
      profileId: 'F6-02-01',
      capabilities: ['rocker'],
      availability: 'online',
    }),
  ).toContainEqual({ field: 'target_id', name: 'Target ID', value: 'None' });
});
