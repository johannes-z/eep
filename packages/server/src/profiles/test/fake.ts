import type {
  EepProfile,
  JsonValue,
  ProfileCommand,
  ProfileDeviceContext,
  ProfileIngressResult,
  ProfilePacket,
  ProfileStateField,
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function capabilities(value: unknown): JsonValue {
  if (
    !Array.isArray(value) ||
    value.length !== 1 ||
    value[0] !== 'contact' ||
    !value.every((item) => typeof item === 'string')
  ) {
    throw new Error('Invalid fake profile capabilities');
  }
  return ['contact'];
}

function state(value: unknown, field: ProfileStateField): JsonValue {
  if (!isRecord(value) || typeof value.contact !== 'boolean') {
    throw new Error(`Invalid ${field}`);
  }
  return { contact: value.contact };
}

export const fakeProfile: EepProfile = {
  metadata: {
    id: 'D5-00-01',
    rorg: 0xd5,
    description: 'Test contact sensor',
  },

  entity: {
    describe: () => ({
      kind: 'binary_sensor',
      protocol: 'Test contact sensor',
      power: false,
      commands: [],
    }),
    projectState: (context) => {
      const source = context.reportedState;
      return { isOn: isRecord(source) && source.contact === true };
    },
    parseCommand: () => {
      throw new Error('Fake contact sensors are read-only');
    },
  },

  defaultCapabilities: () => ['contact'],
  validateCapabilities: capabilities,
  validateState: state,

  decodeIngress(_context: ProfileDeviceContext, packet: ProfilePacket): ProfileIngressResult {
    if (packet.RORG !== 0xd5 || packet.teachIn || packet.payload.length === 0) {
      return { kind: 'ignored' };
    }
    if (packet.payload[0] !== 0 && packet.payload[0] !== 1) return { kind: 'ignored' };
    return {
      kind: 'reported',
      value: packet.payload[0] === 1,
      reportedState: { contact: packet.payload[0] === 1 },
      clearDesiredState: true,
    };
  },

  parseCommand(_context: ProfileDeviceContext, request: unknown): ProfileCommand {
    if (!isRecord(request) || (request.value !== 'open' && request.value !== 'closed')) {
      throw new Error('Fake profile accepts open or closed');
    }
    return { value: request.value };
  },

  encodeCommand(_context: ProfileDeviceContext, command: ProfileCommand): Uint8Array {
    return new Uint8Array([0xd5, command.value === 'open' ? 1 : 0]);
  },
};
