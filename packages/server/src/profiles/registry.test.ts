import { expect, test } from 'bun:test';
import { ProfileRegistry } from './registry';
import type { EepProfile } from './types';

const testProfile: EepProfile = {
  metadata: { id: 'D5-00-01', rorg: 0xd5, description: 'Test contact' },
  defaultCapabilities: () => ['contact'],
  validateCapabilities: (value) => {
    if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'contact') {
      throw new Error('Invalid test capabilities');
    }
    return value;
  },
  validateState: (value) => value,
  decodeIngress: () => ({ kind: 'ignored' }),
  parseCommand: () => ({ value: 'toggle' }),
  encodeCommand: () => new Uint8Array([0xd5, 1]),
};

test('normalizes and resolves registered profile IDs', () => {
  const registry = new ProfileRegistry([testProfile]);

  expect(registry.get('d5-00-01')).toBe(testProfile);
  expect(registry.require('D5-00-01')).toBe(testProfile);
  expect(registry.getByRorg(0xd5)).toEqual([testProfile]);
});

test('rejects duplicate and inconsistent profile registrations', () => {
  expect(() => new ProfileRegistry([testProfile, testProfile])).toThrow('Duplicate EEP profile');
  expect(
    () =>
      new ProfileRegistry([
        { ...testProfile, metadata: { ...testProfile.metadata, id: 'D2-00-01' } },
      ]),
  ).toThrow('EEP profile RORG does not match ID');
});

test('returns undefined for malformed or unknown profile IDs', () => {
  const registry = new ProfileRegistry([testProfile]);

  expect(registry.get('unknown')).toBeUndefined();
  expect(registry.get('D5-00')).toBeUndefined();
  expect(() => registry.require('D2-50-00')).toThrow('Unsupported EEP profile');
});
