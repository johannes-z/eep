import { build4bsFrame } from '../../transport/esp3';
import type { EepProfile, ProfileDeviceContext, ProfilePacket } from '../types';

const intervals = [0, 2, 5, 10, 20, 30, 60, 120];
const capabilityNames = ['valvePosition', 'temperature', 'referenceRun'];

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A5-20-06 value must be an object');
  }
  return value as Record<string, unknown>;
}

function number(value: unknown, name: string, max: number, step = 1): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > max ||
    !Number.isInteger(value / step)
  ) {
    throw new Error(`Invalid A5-20-06 ${name}: expected 0..${max} in steps of ${step}`);
  }
  return value;
}

function boolean(value: unknown, name: string): boolean {
  if (typeof value !== 'boolean') throw new Error(`Invalid A5-20-06 ${name}`);
  return value;
}

function selection<const Choice extends string>(
  value: unknown,
  name: string,
  choices: readonly Choice[],
): Choice {
  if (!choices.includes(value as Choice)) throw new Error(`Invalid A5-20-06 ${name}`);
  return value as Choice;
}

const defaults = {
  mode: 'temperature' as 'temperature' | 'valvePosition',
  setpoint: 21,
  temperatureSetpoint: 21,
  roomTemperature: null as number | null,
  referenceRun: false,
  communicationInterval: 0,
  summerMode: false,
  temperatureSensor: 'ambient' as 'ambient' | 'flow',
  standby: false,
};

function settings(value: unknown) {
  const state = record(value);
  const mode = selection(state.mode, 'mode', ['temperature', 'valvePosition']);
  const communicationInterval = number(state.communicationInterval, 'communicationInterval', 120);
  if (!intervals.includes(communicationInterval))
    throw new Error('Invalid A5-20-06 communicationInterval');
  const roomTemperature =
    state.roomTemperature === null
      ? null
      : number(state.roomTemperature, 'roomTemperature', 40, 0.25);
  if (mode === 'temperature' && roomTemperature === 0) {
    throw new Error(
      'A5-20-06 external roomTemperature must be above zero; use null for the internal sensor',
    );
  }
  const setpoint = number(
    state.setpoint,
    'setpoint',
    mode === 'temperature' ? 40 : 100,
    mode === 'temperature' ? 0.5 : 1,
  );
  const temperatureSetpoint = number(
    state.temperatureSetpoint ?? defaults.temperatureSetpoint,
    'temperatureSetpoint',
    40,
    0.5,
  );
  return {
    mode,
    setpoint,
    temperatureSetpoint: mode === 'temperature' ? setpoint : temperatureSetpoint,
    roomTemperature,
    referenceRun: boolean(state.referenceRun, 'referenceRun'),
    communicationInterval,
    summerMode: boolean(state.summerMode, 'summerMode'),
    temperatureSensor: selection(state.temperatureSensor, 'temperatureSensor', ['ambient', 'flow']),
    standby: boolean(state.standby, 'standby'),
  };
}

function reported(value: unknown) {
  const state = record(value);
  const sensor = selection(state.temperatureSensor, 'temperatureSensor', ['ambient', 'flow']);
  const localOffsetMode = selection(state.localOffsetMode, 'localOffsetMode', [
    'relative',
    'absolute',
  ]);
  const localOffset = state.localOffset === null ? null : state.localOffset;
  if (localOffset !== null) {
    if (localOffsetMode === 'absolute') number(localOffset, 'localOffset', 40, 0.5);
    else if (
      typeof localOffset !== 'number' ||
      !Number.isInteger(localOffset) ||
      Math.abs(localOffset) > 5
    ) {
      throw new Error('Invalid A5-20-06 localOffset');
    }
  }
  return {
    valvePosition:
      state.valvePosition === null ? null : number(state.valvePosition, 'valvePosition', 100),
    localOffsetMode,
    localOffset: localOffset as number | null,
    temperatureSensor: sensor,
    temperature:
      state.temperature === null
        ? null
        : number(state.temperature, 'temperature', sensor === 'ambient' ? 40 : 80, 0.5),
    temperatureError: boolean(state.temperatureError, 'temperatureError'),
    harvesting: boolean(state.harvesting, 'harvesting'),
    energyStorageLow: boolean(state.energyStorageLow, 'energyStorageLow'),
    windowOpen: boolean(state.windowOpen, 'windowOpen'),
    radioError: boolean(state.radioError, 'radioError'),
    signalWeak: boolean(state.signalWeak, 'signalWeak'),
    actuatorObstructed: boolean(state.actuatorObstructed, 'actuatorObstructed'),
  };
}

function decode(packet: ProfilePacket) {
  const data = Array.from(packet.payload);
  if (
    packet.RORG !== 0xa5 ||
    packet.teachIn ||
    data.length !== 4 ||
    data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
    !(data[3] & 0x08)
  )
    return undefined;
  const absolute = (data[1] & 0x80) !== 0;
  const offset = data[1] & 0x7f;
  const flow = (data[3] & 0x80) !== 0;
  return reported({
    valvePosition: data[0] <= 100 ? data[0] : null,
    localOffsetMode: absolute ? 'absolute' : 'relative',
    localOffset: absolute
      ? offset <= 80
        ? offset / 2
        : null
      : offset <= 5
        ? offset
        : offset >= 123
          ? offset - 128
          : null,
    temperatureSensor: flow ? 'flow' : 'ambient',
    temperature: data[2] <= (flow ? 160 : 80) ? data[2] / 2 : null,
    temperatureError: data[2] === 255,
    harvesting: Boolean(data[3] & 0x40),
    energyStorageLow: !(data[3] & 0x20),
    windowOpen: Boolean(data[3] & 0x10),
    radioError: Boolean(data[3] & 0x04),
    signalWeak: Boolean(data[3] & 0x02),
    actuatorObstructed: Boolean(data[3] & 0x01),
  });
}

function currentSettings(context: ProfileDeviceContext) {
  if (context.desiredState !== undefined) return settings(context.desiredState);
  if (context.reportedState !== undefined) {
    const state = reported(context.reportedState);
    if (state.localOffsetMode === 'absolute' && state.localOffset !== null) {
      return { ...defaults, setpoint: state.localOffset, temperatureSetpoint: state.localOffset };
    }
    if (state.localOffsetMode === 'relative' && state.valvePosition !== null) {
      return { ...defaults, mode: 'valvePosition' as const, setpoint: state.valvePosition };
    }
  }
  return { ...defaults };
}

export const a5Profile: EepProfile = {
  metadata: {
    id: 'A5-20-06',
    rorg: 0xa5,
    description:
      'Harvesting-powered heating actuator with local temperature offset (Micropelt MVA005)',
  },
  fourBsTeachIn: true,
  commandDelivery: 'onReceive',
  defaultCapabilities: () => [...capabilityNames],
  validateCapabilities(value) {
    if (
      !Array.isArray(value) ||
      value.length !== capabilityNames.length ||
      capabilityNames.some((name) => !value.includes(name))
    ) {
      throw new Error('Invalid A5-20-06 capabilities');
    }
    return [...capabilityNames];
  },
  validateState: (value, field) => (field === 'desiredState' ? settings(value) : reported(value)),
  decodeIngress(_context, packet) {
    const state = decode(packet);
    return state
      ? { kind: 'reported', value: state, reportedState: state, clearDesiredState: false }
      : { kind: 'ignored' };
  },
  parseCommand(context, request) {
    const envelope = record(request);
    const patch = 'value' in envelope ? record(envelope.value) : envelope;
    if (
      !Object.keys(patch).length ||
      Object.keys(patch).some((key) => !Object.hasOwn(defaults, key))
    ) {
      throw new Error('Unsupported A5-20-06 command field');
    }
    const previous = currentSettings(context);
    if (patch.mode !== undefined && patch.mode !== previous.mode && patch.setpoint === undefined) {
      throw new Error('Changing A5-20-06 mode requires a setpoint');
    }
    const state = settings({ ...previous, ...patch });
    return { value: state, desiredState: state };
  },
  encodeCommand(context, command) {
    const state = settings(command.value);
    const control =
      (state.referenceRun ? 0x80 : 0) |
      (intervals.indexOf(state.communicationInterval) << 4) |
      (state.summerMode ? 0x08 : 0) |
      (state.mode === 'temperature' ? 0x04 : 0) |
      (state.temperatureSensor === 'flow' ? 0x02 : 0) |
      (state.standby ? 0x01 : 0);
    return build4bsFrame(context.sourceId, context.targetId, [
      state.setpoint * (state.mode === 'temperature' ? 2 : 1),
      state.roomTemperature === null ? 0xff : state.roomTemperature * 4,
      control,
      0x08,
    ]);
  },
  replyOnReceive(context, packet) {
    const state = decode(packet);
    if (!state) return undefined;
    const desired = currentSettings({ ...context, reportedState: state });
    return { value: desired, desiredState: { ...desired, referenceRun: false } };
  },
  entity: {
    describe: () => ({
      kind: 'climate',
      protocol: 'A5-20-06 Micropelt MVA005',
      power: false,
      commands: ['command', 'temperature', 'mode'],
      jsonState: true,
      publishInitialState: true,
      temperature: { min: 0, max: 40, step: 0.5 },
      discoveryEntities: [
        { key: '', name: null },
        {
          key: 'valve_target',
          name: 'Valve target',
          kind: 'number',
          unit: '%',
          min: 0,
          max: 100,
          step: 1,
          valueTemplate: '{{ value_json.requestedValvePosition }}',
          commandTemplate:
            '{"mode":"valvePosition","setpoint":{{ value }},"standby":false,"summerMode":false}',
        },
        {
          key: 'valve_position',
          name: 'Valve position',
          kind: 'sensor',
          unit: '%',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.valvePosition }}',
        },
        {
          key: 'ambient_temperature',
          name: 'Ambient temperature',
          kind: 'sensor',
          deviceClass: 'temperature',
          unit: '\u00b0C',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.currentTemperature }}',
        },
        {
          key: 'flow_temperature',
          name: 'Flow temperature',
          kind: 'sensor',
          deviceClass: 'temperature',
          unit: '\u00b0C',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.flowTemperature }}',
        },
        {
          key: 'local_offset',
          name: 'Local temperature offset',
          kind: 'sensor',
          unit: 'K',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.localTemperatureOffset }}',
        },
        {
          key: 'energy_storage_low',
          name: 'Energy storage low',
          kind: 'binary_sensor',
          deviceClass: 'battery',
          valueTemplate:
            "{{ 'None' if value_json.energyStorageLow is none else 'ON' if value_json.energyStorageLow else 'OFF' }}",
        },
        {
          key: 'summer_mode',
          name: 'Summer mode',
          kind: 'switch',
          valueTemplate: "{{ 'ON' if value_json.summerMode else 'OFF' }}",
          commandTemplate: '{"summerMode":{{ "true" if value == "ON" else "false" }}}',
        },
      ],
      controls: [
        {
          field: 'mode',
          label: 'Control mode',
          kind: 'select',
          options: [
            { value: 'temperature', label: 'Temperature' },
            { value: 'valvePosition', label: 'Valve position' },
          ],
        },
        {
          field: 'setpoint',
          label: 'Setpoint (C / %)',
          kind: 'number',
          min: 0,
          max: 100,
          step: 0.5,
        },
        {
          field: 'roomTemperature',
          label: 'External temperature (C)',
          kind: 'number',
          min: 0.25,
          max: 40,
          step: 0.25,
          nullable: true,
        },
        {
          field: 'communicationInterval',
          label: 'Radio interval',
          kind: 'select',
          options: intervals.map((value) => ({
            value,
            label: value === 0 ? 'Automatic' : `${value} minutes`,
          })),
        },
        {
          field: 'temperatureSensor',
          stateKey: 'requestedTemperatureSensor',
          label: 'Requested sensor',
          kind: 'select',
          options: [
            { value: 'ambient', label: 'Ambient' },
            { value: 'flow', label: 'Flow' },
          ],
        },
        { field: 'summerMode', label: 'Summer mode', kind: 'boolean' },
        { field: 'standby', label: 'Standby (local wake-up)', kind: 'boolean' },
        { field: 'referenceRun', label: 'Reference run', kind: 'action' },
      ],
    }),
    projectState(context) {
      const desired = currentSettings(context);
      const state =
        context.reportedState === undefined ? undefined : reported(context.reportedState);
      return {
        isOn: !desired.standby && desired.setpoint > 0,
        attributes: {
          ...desired,
          ...state,
          requestedTemperatureSensor: desired.temperatureSensor,
          requestedValvePosition: desired.mode === 'valvePosition' ? desired.setpoint : null,
          valvePosition: state?.valvePosition ?? null,
          energyStorageLow: state?.energyStorageLow ?? null,
          localTemperatureOffset: state?.localOffsetMode === 'relative' ? state.localOffset : null,
          currentTemperature: state?.temperatureSensor === 'ambient' ? state.temperature : null,
          flowTemperature: state?.temperatureSensor === 'flow' ? state.temperature : null,
          targetTemperature: desired.temperatureSetpoint,
          hvacMode:
            (context.desiredState === undefined && state === undefined) ||
            desired.mode !== 'temperature' ||
            desired.standby ||
            desired.summerMode ||
            desired.setpoint === 0
              ? 'off'
              : 'heat',
        },
      };
    },
    parseCommand(context, field, value) {
      if (field === 'command') return record(JSON.parse(value));
      if (field === 'temperature' && value.trim()) {
        return {
          mode: 'temperature',
          setpoint: number(Number(value), 'setpoint', 40, 0.5),
          standby: false,
          summerMode: false,
        };
      }
      if (field === 'mode' && value === 'off')
        return { mode: 'valvePosition', setpoint: 0, standby: false };
      if (field === 'mode' && value === 'heat') {
        const previous = currentSettings(context);
        return {
          mode: 'temperature',
          setpoint: previous.temperatureSetpoint > 0 ? previous.temperatureSetpoint : 21,
          standby: false,
          summerMode: false,
        };
      }
      throw new Error(`Invalid A5-20-06 entity command: ${field}`);
    },
  },
};
