import { changeState } from './changeState';
import {
  d2ValueToFanState,
  fanPercentageToD2Value,
  fanSpeedToD2Value,
  fanPowerToD2Value,
  fanPresetToD2Value,
  fanD2ValueToSpeed,
  fanSpeedCount,
  fanSupportedPresets,
  isD2ControlValue,
  parseD2Value,
  type D2FanState,
} from './fan';
import {
  getDefaultSupportedFunctions,
  getProtocolFunctions,
  getProtocolFunctionByValue,
} from './functions';
import { toHex } from '../../util/toHex';
import type {
  EepProfile,
  JsonValue,
  ProfileCommand,
  ProfileDeviceContext,
  ProfileEntityAdapter,
  ProfileEntityContext,
  ProfileEntityDescriptor,
  ProfileEntityState,
  ProfileIngressResult,
  ProfilePacket,
  ProfileStateField,
} from '../types';

const profileId = 'D2-50-00';
const protocolFunctions = getProtocolFunctions();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isBasicStatusPayload(payload: ArrayLike<number>): boolean {
  return (
    payload.length === 14 &&
    Array.from(payload).every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 0xff) &&
    payload[0] >> 5 === 2
  );
}

export function decodeD2Value(payload: ArrayLike<number>): number | undefined {
  if (!isBasicStatusPayload(payload)) return undefined;
  const operationMode = payload[0] & 0x0f;
  return isD2ControlValue(operationMode) && operationMode !== 15 ? operationMode : undefined;
}

function supportedFunctions(value: unknown): string[] {
  if (!Array.isArray(value) || value.some((id) => typeof id !== 'string')) {
    throw new Error('Invalid D2-50-00 capabilities');
  }
  if (
    new Set(value).size !== value.length ||
    value.some((id) => !Object.hasOwn(protocolFunctions, id))
  ) {
    throw new Error('Invalid D2-50-00 capabilities');
  }
  return [...value];
}

function stateValue(value: unknown, field: ProfileStateField, capabilities: unknown): D2FanState {
  if (!isRecord(value)) throw new Error(`Invalid ${field}`);
  const { isOn, percentage, preset, d2Value } = value;
  if (typeof isOn !== 'boolean') throw new Error(`Invalid ${field}.isOn`);
  if (
    typeof percentage !== 'number' ||
    !Number.isFinite(percentage) ||
    percentage < 0 ||
    percentage > 100
  ) {
    throw new Error(`Invalid ${field}.percentage`);
  }
  if (
    typeof d2Value !== 'number' ||
    !Number.isInteger(d2Value) ||
    !isD2ControlValue(d2Value) ||
    d2Value === 15
  ) {
    throw new Error(`Invalid ${field}.d2Value`);
  }
  const functions = supportedFunctions(capabilities);
  const definition = getProtocolFunctionByValue(d2Value);
  if (field === 'desiredState' && (!definition || !functions.includes(definition.id))) {
    throw new Error(`Invalid ${field}.d2Value: unsupported by device`);
  }
  const state = d2ValueToFanState(d2Value, percentage, functions);
  if (preset !== undefined && preset !== state.preset) {
    throw new Error(`Invalid ${field}.preset`);
  }
  return { ...state, percentage };
}

function commandValue(value: unknown, capabilities: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('D2-50-00 command value must be a string or number');
  }
  const parsed = parseD2Value(value);
  const definition = getProtocolFunctionByValue(parsed);
  if (parsed !== 15 && (!definition || !supportedFunctions(capabilities).includes(definition.id))) {
    throw new Error(`Device does not support function for value: ${parsed}`);
  }
  return parsed;
}

function requestValue(request: unknown, context: ProfileDeviceContext): number {
  if (!isRecord(request)) throw new Error('D2-50-00 command must be an object');
  if ('value' in request) return commandValue(request.value, context.capabilities);
  if ('preset' in request) {
    if (typeof request.preset !== 'string') throw new Error('preset must be a string');
    return commandValue(fanPresetToD2Value(request.preset), context.capabilities);
  }
  if ('percentage' in request) {
    if (typeof request.percentage !== 'number') throw new Error('percentage must be a number');
    return commandValue(
      fanPercentageToD2Value(request.percentage, supportedFunctions(context.capabilities)),
      context.capabilities,
    );
  }
  if ('isOn' in request) {
    if (typeof request.isOn !== 'boolean') throw new Error('isOn must be a boolean');
    return commandValue(
      fanPowerToD2Value(request.isOn, supportedFunctions(context.capabilities)),
      context.capabilities,
    );
  }
  throw new Error('Expected value, percentage, preset, or isOn');
}

function previousPercentage(context: ProfileDeviceContext): number {
  const desired = isRecord(context.desiredState) ? context.desiredState.percentage : undefined;
  const reported = isRecord(context.reportedState) ? context.reportedState.percentage : undefined;
  return typeof desired === 'number' ? desired : typeof reported === 'number' ? reported : 0;
}

function currentState(context: ProfileEntityContext): D2FanState {
  const desired = isRecord(context.desiredState) ? context.desiredState : undefined;
  const reported = isRecord(context.reportedState) ? context.reportedState : undefined;
  const desiredValue = desired?.d2Value;
  const reportedValue = reported?.d2Value;
  const value =
    typeof desiredValue === 'number' && desiredValue !== reportedValue
      ? desiredValue
      : typeof reportedValue === 'number'
        ? reportedValue
        : 0;
  return d2ValueToFanState(
    value,
    previousPercentage(context),
    supportedFunctions(context.capabilities),
  );
}

const entity = {
  describe(context: ProfileEntityContext): ProfileEntityDescriptor {
    const functions = supportedFunctions(context.capabilities);
    const speedCount = fanSpeedCount(functions);
    const presets = fanSupportedPresets(functions);
    return {
      kind: 'fan',
      protocol: 'D2-50-00 ventilation fan',
      power: true,
      commands: ['command', 'percentage', 'preset'],
      ...(speedCount ? { percentage: { min: 1, max: speedCount } } : {}),
      ...(presets.length ? { presets } : {}),
    };
  },

  projectState(context: ProfileEntityContext): ProfileEntityState {
    const state = currentState(context);
    return {
      isOn: state.isOn,
      percentage: fanD2ValueToSpeed(state.d2Value, supportedFunctions(context.capabilities)),
      ...(state.preset ? { preset: state.preset } : {}),
    };
  },

  parseCommand(context: ProfileEntityContext, field: string, value: string): unknown {
    const functions = supportedFunctions(context.capabilities);
    if (field === 'command') {
      if (value === 'ON') return fanPowerToD2Value(true, functions);
      if (value === 'OFF') return fanPowerToD2Value(false, functions);
      throw new Error(`Invalid fan power command: ${value}`);
    }
    if (field === 'percentage') {
      if (!value.trim()) throw new Error('Fan speed is required');
      return fanSpeedToD2Value(Number(value), functions);
    }
    if (field === 'preset') return commandValue(fanPresetToD2Value(value), functions);
    throw new Error(`Unsupported D2-50-00 entity command: ${field}`);
  },
} satisfies ProfileEntityAdapter;

export const d2Profile: EepProfile = {
  metadata: {
    id: profileId,
    rorg: 0xd2,
    description: 'Ventilation system',
  },
  entity,

  defaultCapabilities(): JsonValue {
    return getDefaultSupportedFunctions();
  },

  validateCapabilities(value: unknown): JsonValue {
    return supportedFunctions(value);
  },

  validateState(value: unknown, field: ProfileStateField, capabilities: unknown): unknown {
    return stateValue(value, field, capabilities);
  },

  decodeIngress(context: ProfileDeviceContext, packet: ProfilePacket): ProfileIngressResult {
    if (packet.RORG !== 0xd2 || packet.teachIn) return { kind: 'ignored' };
    const value = decodeD2Value(packet.payload);
    if (value === undefined || value === 15) return { kind: 'ignored' };
    const reportedState = d2ValueToFanState(
      value,
      previousPercentage(context),
      supportedFunctions(context.capabilities),
    );
    return {
      kind: 'reported',
      value,
      reportedState,
      clearDesiredState: true,
    };
  },

  parseCommand(context: ProfileDeviceContext, request: unknown): ProfileCommand {
    const value = requestValue(request, context);
    return {
      value,
      desiredState:
        value === 15
          ? undefined
          : d2ValueToFanState(
              value,
              previousPercentage(context),
              supportedFunctions(context.capabilities),
            ),
    };
  },

  encodeCommand(context: ProfileDeviceContext, command: ProfileCommand): Uint8Array {
    const value = commandValue(command.value, context.capabilities);
    return changeState(toHex(context.sourceId), toHex(context.targetId), value);
  },
};
