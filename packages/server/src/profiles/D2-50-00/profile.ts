import { changeState } from './changeState';
import { DirectOperationModeControl } from './DirectOperationModeControl';
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

interface D2SensorState {
  airQuality?: number;
  filterMaintenance: boolean;
  outdoorTemperature: number;
  supplyAirTemperature: number;
  supplyAirFlow: number;
  exhaustAirFlow: number;
  supplyFanSpeed: number;
  exhaustFanSpeed: number;
}

type D2OperationModeControl = 'none' | 'next' | 'previous';

interface D2ControlSettings {
  operationMode: D2OperationModeControl;
  co2Threshold: number | null;
  humidityThreshold: number | null;
  airQualityThreshold: number | null;
}

interface D2ControlRequest {
  value: number;
  settings: D2ControlSettings;
  timerOperationMode: boolean;
}

type D2State = D2FanState & Partial<D2SensorState> & Partial<D2ControlSettings>;

const controlFields = [
  'operationMode',
  'timerOperationMode',
  'co2Threshold',
  'humidityThreshold',
  'airQualityThreshold',
] as const;

const defaultControlSettings: D2ControlSettings = {
  operationMode: 'none',
  co2Threshold: null,
  humidityThreshold: null,
  airQualityThreshold: null,
};

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

function readBits(payload: ArrayLike<number>, offset: number, size: number): number {
  let value = 0;
  for (let bit = offset; bit < offset + size; bit += 1) {
    value = (value << 1) | ((payload[Math.floor(bit / 8)] >> (7 - (bit % 8))) & 1);
  }
  return value;
}

function decodeSensors(payload: ArrayLike<number>): D2SensorState {
  const airQuality = readBits(payload, 25, 7);
  return {
    ...(airQuality <= 100 ? { airQuality } : {}),
    filterMaintenance: readBits(payload, 22, 1) === 1,
    outdoorTemperature: readBits(payload, 40, 7) - 64,
    supplyAirTemperature: readBits(payload, 47, 7) - 64,
    supplyAirFlow: readBits(payload, 68, 10),
    exhaustAirFlow: readBits(payload, 78, 10),
    supplyFanSpeed: readBits(payload, 88, 12),
    exhaustFanSpeed: readBits(payload, 100, 12),
  };
}

function hasControlFields(value: Record<string, unknown>): boolean {
  return controlFields.some((field) => Object.hasOwn(value, field));
}

function threshold(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 100) {
    throw new Error(`Invalid D2-50-00 ${name}: expected null or an integer from 0 to 100`);
  }
  return value;
}

function operationMode(value: unknown): D2OperationModeControl {
  if (value !== 'none' && value !== 'next' && value !== 'previous') {
    throw new Error(`Invalid D2-50-00 operation mode control: ${String(value)}`);
  }
  return value;
}

function controlSettings(
  value: Record<string, unknown>,
  fallback: D2ControlSettings = defaultControlSettings,
): D2ControlSettings {
  return {
    operationMode: Object.hasOwn(value, 'operationMode')
      ? operationMode(value.operationMode)
      : fallback.operationMode,
    co2Threshold: Object.hasOwn(value, 'co2Threshold')
      ? threshold(value.co2Threshold, 'CO2 threshold')
      : fallback.co2Threshold,
    humidityThreshold: Object.hasOwn(value, 'humidityThreshold')
      ? threshold(value.humidityThreshold, 'humidity threshold')
      : fallback.humidityThreshold,
    airQualityThreshold: Object.hasOwn(value, 'airQualityThreshold')
      ? threshold(value.airQualityThreshold, 'air quality threshold')
      : fallback.airQualityThreshold,
  };
}

function timerOperationMode(value: unknown): boolean {
  if (value !== undefined && value !== true) {
    throw new Error('D2-50-00 timer operation mode must be true');
  }
  return value === true;
}

function currentControlSettings(context: ProfileDeviceContext): D2ControlSettings {
  const desired = isRecord(context.desiredState) ? context.desiredState : undefined;
  return desired && hasControlFields(desired)
    ? controlSettings(desired)
    : { ...defaultControlSettings };
}

function hasDesiredControlSettings(context: ProfileDeviceContext): boolean {
  return isRecord(context.desiredState) && hasControlFields(context.desiredState);
}

function operationModeValue(value: D2OperationModeControl): number {
  return value === 'next' ? 1 : value === 'previous' ? 2 : 0;
}

function encodedThreshold(value: number | null): number {
  return value ?? 127;
}

function controlOptions(settings: D2ControlSettings) {
  return {
    operationMode: operationModeValue(settings.operationMode),
    co2Threshold: encodedThreshold(settings.co2Threshold),
    humidityThreshold: encodedThreshold(settings.humidityThreshold),
    airQualityThreshold: encodedThreshold(settings.airQualityThreshold),
  };
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

function stateValue(value: unknown, field: ProfileStateField, capabilities: unknown): D2State {
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
  const controlState =
    field === 'desiredState' && hasControlFields(value) ? controlSettings(value) : {};
  const sensorState: Partial<D2SensorState> = {};
  if (field === 'reportedState') {
    for (const [key, minimum, maximum] of [
      ['airQuality', 0, 100],
      ['outdoorTemperature', -64, 63],
      ['supplyAirTemperature', -64, 63],
      ['supplyAirFlow', 0, 1023],
      ['exhaustAirFlow', 0, 1023],
      ['supplyFanSpeed', 0, 4095],
      ['exhaustFanSpeed', 0, 4095],
    ] as const) {
      const sensorValue = value[key];
      if (
        sensorValue !== undefined &&
        (typeof sensorValue !== 'number' ||
          !Number.isFinite(sensorValue) ||
          sensorValue < minimum ||
          sensorValue > maximum)
      ) {
        throw new Error(`Invalid ${field}.${key}`);
      }
      if (sensorValue !== undefined) sensorState[key] = sensorValue;
    }
    if (value.filterMaintenance !== undefined && typeof value.filterMaintenance !== 'boolean') {
      throw new Error(`Invalid ${field}.filterMaintenance`);
    }
    if (value.filterMaintenance !== undefined) {
      sensorState.filterMaintenance = value.filterMaintenance;
    }
  }
  return { ...state, percentage, ...controlState, ...sensorState };
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

function requestValue(request: unknown, context: ProfileDeviceContext): number | D2ControlRequest {
  if (!isRecord(request)) throw new Error('D2-50-00 command must be an object');
  if (Object.hasOwn(request, 'resetThresholds')) {
    if (
      request.resetThresholds !== true ||
      Object.keys(request).some((key) => key !== 'resetThresholds')
    ) {
      throw new Error('Invalid D2-50-00 reset thresholds command');
    }
    return {
      value: DirectOperationModeControl.NoAction,
      settings: {
        operationMode: 'none',
        co2Threshold: null,
        humidityThreshold: null,
        airQualityThreshold: null,
      },
      timerOperationMode: false,
    };
  }
  const structured = hasControlFields(request);
  if (
    structured &&
    Object.keys(request).some((key) => !['value', ...controlFields].includes(key))
  ) {
    throw new Error('Unsupported D2-50-00 command field');
  }
  if ('value' in request) {
    const value = commandValue(request.value, context.capabilities);
    if (!structured) return value;
    const settings = controlSettings(request, currentControlSettings(context));
    return {
      value,
      settings,
      timerOperationMode: timerOperationMode(request.timerOperationMode),
    };
  }
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
  if (structured) {
    const settings = controlSettings(request, currentControlSettings(context));
    return {
      value: DirectOperationModeControl.NoAction,
      settings,
      timerOperationMode: timerOperationMode(request.timerOperationMode),
    };
  }
  throw new Error('Expected value, percentage, preset, or isOn');
}

function previousPercentage(context: ProfileDeviceContext): number {
  const desired = isRecord(context.desiredState) ? context.desiredState.percentage : undefined;
  const reported = isRecord(context.reportedState) ? context.reportedState.percentage : undefined;
  return typeof desired === 'number' ? desired : typeof reported === 'number' ? reported : 0;
}

function currentState(context: ProfileEntityContext): D2State {
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
      jsonState: true,
      discoveryEntities: [
        {
          key: '',
          name: null,
        },
        {
          key: 'air_quality',
          name: 'Air quality',
          kind: 'sensor',
          unit: '%',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.airQuality }}',
        },
        {
          key: 'filter_maintenance',
          name: 'Filter maintenance',
          kind: 'binary_sensor',
          valueTemplate: "{{ 'ON' if value_json.filterMaintenance else 'OFF' }}",
          entityCategory: 'diagnostic',
        },
        {
          key: 'outdoor_temperature',
          name: 'Outdoor temperature',
          kind: 'sensor',
          deviceClass: 'temperature',
          unit: '\u00b0C',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.outdoorTemperature }}',
        },
        {
          key: 'supply_air_temperature',
          name: 'Supply air temperature',
          kind: 'sensor',
          deviceClass: 'temperature',
          unit: '\u00b0C',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.supplyAirTemperature }}',
        },
        {
          key: 'supply_air_flow',
          name: 'Supply air flow',
          kind: 'sensor',
          unit: 'm3/h',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.supplyAirFlow }}',
        },
        {
          key: 'exhaust_air_flow',
          name: 'Exhaust air flow',
          kind: 'sensor',
          unit: 'm3/h',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.exhaustAirFlow }}',
        },
        {
          key: 'supply_fan_speed',
          name: 'Supply fan speed',
          kind: 'sensor',
          unit: 'rpm',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.supplyFanSpeed }}',
        },
        {
          key: 'exhaust_fan_speed',
          name: 'Exhaust fan speed',
          kind: 'sensor',
          unit: 'rpm',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.exhaustFanSpeed }}',
        },
        {
          key: 'co2_threshold',
          name: 'CO2 threshold',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
          valueTemplate: '{{ value_json.co2Threshold }}',
          commandTemplate: '{"co2Threshold":{{ value }}}',
        },
        {
          key: 'humidity_threshold',
          name: 'Humidity threshold',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
          valueTemplate: '{{ value_json.humidityThreshold }}',
          commandTemplate: '{"humidityThreshold":{{ value }}}',
        },
        {
          key: 'air_quality_threshold',
          name: 'Air quality threshold',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
          valueTemplate: '{{ value_json.airQualityThreshold }}',
          commandTemplate: '{"airQualityThreshold":{{ value }}}',
        },
        {
          key: 'operation_mode',
          name: 'Operation mode control',
          kind: 'select',
          options: ['none', 'next', 'previous'],
          valueTemplate: '{{ value_json.operationMode }}',
          commandTemplate: '{"operationMode":"{{ value }}"}',
        },
        {
          key: 'timer_operation_mode',
          name: 'Start timer operation',
          kind: 'button',
          commandTemplate: '{"timerOperationMode":true}',
        },
        {
          key: 'reset_thresholds',
          name: 'Reset thresholds',
          kind: 'button',
          commandTemplate: '{"resetThresholds":true}',
        },
      ],
      protocol: 'D2-50-00 ventilation fan',
      power: true,
      commands: ['command', 'percentage', 'preset'],
      ...(speedCount ? { percentage: { min: 1, max: speedCount } } : {}),
      ...(presets.length ? { presets } : {}),
      controls: [
        {
          field: 'operationMode',
          label: 'Next / previous mode',
          kind: 'select',
          options: [
            { value: 'none', label: 'No action' },
            { value: 'next', label: 'Next mode' },
            { value: 'previous', label: 'Previous mode' },
          ],
        },
        {
          field: 'co2Threshold',
          label: 'CO2 threshold (%)',
          kind: 'number',
          min: 0,
          max: 100,
          step: 1,
          nullable: true,
        },
        {
          field: 'humidityThreshold',
          label: 'Humidity threshold (%)',
          kind: 'number',
          min: 0,
          max: 100,
          step: 1,
          nullable: true,
        },
        {
          field: 'airQualityThreshold',
          label: 'Air quality threshold (%)',
          kind: 'number',
          min: 0,
          max: 100,
          step: 1,
          nullable: true,
        },
        { field: 'timerOperationMode', label: 'Start timer operation', kind: 'action' },
        { field: 'resetThresholds', label: 'Reset thresholds', kind: 'action' },
      ],
    };
  },

  projectState(context: ProfileEntityContext): ProfileEntityState {
    const state = currentState(context);
    const reported = isRecord(context.reportedState) ? context.reportedState : undefined;
    const attributes: Record<string, JsonValue> = {};
    const controls = currentControlSettings(context);
    Object.assign(attributes, controls);
    for (const key of [
      'airQuality',
      'filterMaintenance',
      'outdoorTemperature',
      'supplyAirTemperature',
      'supplyAirFlow',
      'exhaustAirFlow',
      'supplyFanSpeed',
      'exhaustFanSpeed',
    ] as const) {
      const sensorValue = reported?.[key];
      if (typeof sensorValue === 'number' || typeof sensorValue === 'boolean') {
        attributes[key] = sensorValue;
      }
    }
    return {
      isOn: state.isOn,
      percentage: fanD2ValueToSpeed(state.d2Value, supportedFunctions(context.capabilities)),
      ...(state.preset ? { preset: state.preset } : {}),
      ...(Object.keys(attributes).length ? { attributes } : {}),
    };
  },

  parseCommand(context: ProfileEntityContext, field: string, value: string): unknown {
    const functions = supportedFunctions(context.capabilities);
    if (field === 'command') {
      if (value === 'ON') return fanPowerToD2Value(true, functions);
      if (value === 'OFF') return fanPowerToD2Value(false, functions);
      try {
        const request = JSON.parse(value);
        if (isRecord(request)) return request;
      } catch {}
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
      reportedState: { ...reportedState, ...decodeSensors(packet.payload) },
      clearDesiredState: true,
    };
  },

  parseCommand(context: ProfileDeviceContext, request: unknown): ProfileCommand {
    const parsed = requestValue(request, context);
    const value = typeof parsed === 'number' ? parsed : parsed.value;
    const fanState =
      value === 15
        ? undefined
        : d2ValueToFanState(
            value,
            previousPercentage(context),
            supportedFunctions(context.capabilities),
          );
    return {
      value: parsed,
      desiredState:
        typeof parsed === 'number'
          ? fanState && hasDesiredControlSettings(context)
            ? { ...fanState, ...currentControlSettings(context) }
            : fanState
          : {
              ...currentState(context),
              ...parsed.settings,
              operationMode: 'none',
            },
    };
  },

  encodeCommand(context: ProfileDeviceContext, command: ProfileCommand): Uint8Array {
    const commandRecord = isRecord(command.value) ? command.value : undefined;
    const settingsRecord =
      commandRecord !== undefined && isRecord(commandRecord.settings)
        ? commandRecord.settings
        : undefined;
    const value = commandValue(
      settingsRecord !== undefined ? commandRecord!.value : command.value,
      context.capabilities,
    );
    if (settingsRecord === undefined) {
      return changeState(
        toHex(context.sourceId),
        toHex(context.targetId),
        value,
        hasDesiredControlSettings(context)
          ? controlOptions(currentControlSettings(context))
          : undefined,
      );
    }
    const structuredCommand = commandRecord!;
    const settings = controlSettings(settingsRecord);
    return changeState(toHex(context.sourceId), toHex(context.targetId), value, {
      ...controlOptions(settings),
      timerOperationMode: structuredCommand.timerOperationMode === true,
    });
  },
};
