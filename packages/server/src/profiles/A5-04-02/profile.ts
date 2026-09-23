import type { EepProfile, JsonValue, ProfilePacket, ProfileStateField } from '../types';

interface TemperatureHumidityState {
  readonly [key: string]: JsonValue;
  temperature: number;
  humidity: number;
}

function readOnly(): never {
  throw new Error('A5-04-02 temperature and humidity sensors are read-only');
}

function state(value: unknown, field: ProfileStateField): TemperatureHumidityState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Invalid ${field} for A5-04-02`);
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.temperature !== 'number' ||
    !Number.isFinite(candidate.temperature) ||
    candidate.temperature < -20 ||
    candidate.temperature > 60 ||
    typeof candidate.humidity !== 'number' ||
    !Number.isFinite(candidate.humidity) ||
    candidate.humidity < 0 ||
    candidate.humidity > 100
  ) {
    throw new Error(`Invalid ${field} for A5-04-02`);
  }
  return {
    temperature: candidate.temperature,
    humidity: candidate.humidity,
  };
}

function decode(packet: ProfilePacket): TemperatureHumidityState | undefined {
  const data = Array.from(packet.payload);
  if (
    packet.RORG !== 0xa5 ||
    packet.teachIn ||
    data.length !== 4 ||
    data.some((byte) => !Number.isInteger(byte) || byte < 0 || byte > 255) ||
    data[0] !== 0 ||
    (data[3] & 0x08) === 0 ||
    data[1] > 250 ||
    data[2] > 250
  ) {
    return undefined;
  }
  return state(
    {
      temperature: Math.round(((data[2] * 80) / 250 - 20) * 100) / 100,
      humidity: (data[1] * 100) / 250,
    },
    'reportedState',
  );
}

export const a5TemperatureHumidityExtendedProfile: EepProfile = {
  receiveOnly: true,
  metadata: {
    id: 'A5-04-02',
    rorg: 0xa5,
    description: 'Temperature and Humidity Sensor (-20...60 degC, 0...100 % RH)',
  },
  entity: {
    describe: () => ({
      kind: 'sensor',
      jsonState: true,
      discoveryEntities: [
        {
          key: 'temperature',
          name: 'Temperature',
          kind: 'sensor',
          deviceClass: 'temperature',
          unit: '\u00b0C',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.temperature }}',
        },
        {
          key: 'humidity',
          name: 'Humidity',
          kind: 'sensor',
          deviceClass: 'humidity',
          unit: '%',
          stateClass: 'measurement',
          valueTemplate: '{{ value_json.humidity }}',
        },
      ],
      protocol: 'A5-04-02 temperature and humidity sensor',
      power: false,
      commands: [],
    }),
    projectState: (context) => {
      if (context.reportedState === undefined) return { isOn: false };
      return { isOn: true, attributes: state(context.reportedState, 'reportedState') };
    },
    parseCommand: readOnly,
  },
  defaultCapabilities: () => ['temperature', 'humidity'],
  validateCapabilities(value: unknown): JsonValue {
    if (
      !Array.isArray(value) ||
      value.length !== 2 ||
      value[0] !== 'temperature' ||
      value[1] !== 'humidity'
    ) {
      throw new Error('Invalid A5-04-02 capabilities');
    }
    return ['temperature', 'humidity'];
  },
  validateState(value, field) {
    if (field === 'desiredState') return readOnly();
    return state(value, field);
  },
  decodeIngress(_context, packet) {
    const value = decode(packet);
    if (!value) return { kind: 'ignored' };
    return {
      kind: 'reported',
      value,
      reportedState: value,
      clearDesiredState: true,
    };
  },
  parseCommand: readOnly,
  encodeCommand: readOnly,
};
