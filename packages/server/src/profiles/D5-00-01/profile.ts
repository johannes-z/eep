import type { EepProfile, JsonValue, ProfileStateField } from '../types';

function contactState(value: unknown, field: ProfileStateField): { open: boolean } {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('open' in value) ||
    typeof value.open !== 'boolean'
  ) {
    throw new Error(`Invalid ${field}.open`);
  }
  return { open: value.open };
}

function readOnly(): never {
  throw new Error('D5-00-01 contact sensors are read-only');
}

export const d5Profile: EepProfile = {
  metadata: {
    id: 'D5-00-01',
    rorg: 0xd5,
    description: 'Single Input Contact',
  },

  entity: {
    describe: () => ({
      kind: 'binary_sensor',
      deviceClass: 'opening',
      protocol: 'D5-00-01 single input contact',
      power: false,
      commands: [],
    }),
    projectState: (context) => ({
      isOn:
        context.reportedState !== undefined &&
        contactState(context.reportedState, 'reportedState').open,
    }),
    parseCommand: readOnly,
  },

  defaultCapabilities: () => ['contact'],
  validateCapabilities(value: unknown): JsonValue {
    if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'contact') {
      throw new Error('Invalid D5-00-01 capabilities');
    }
    return ['contact'];
  },
  validateState(value, field) {
    if (field === 'desiredState') return readOnly();
    return contactState(value, field);
  },

  decodeIngress(_context, packet) {
    if (packet.RORG !== 0xd5 || packet.teachIn || packet.payload.length !== 1) {
      return { kind: 'ignored' };
    }
    const data = packet.payload[0];
    if (!Number.isInteger(data) || data < 0 || data > 0xff || (data & 0x08) === 0) {
      return { kind: 'ignored' };
    }
    const open = (data & 0x01) === 0;
    return {
      kind: 'reported',
      value: open,
      reportedState: { open },
      clearDesiredState: true,
    };
  },

  parseCommand: readOnly,
  encodeCommand: readOnly,
};
