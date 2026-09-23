import { expect, test } from 'bun:test';
import { d2Profile } from './profile';
import { Esp3Parser } from '../../transport/esp3';
import { changeState } from './changeState';

const context = {
  sourceId: 0xffe76681,
  targetId: 0x05126787,
  capabilities: d2Profile.defaultCapabilities(),
};

test.each(['toString', 'constructor', '__proto__'])(
  'rejects inherited capability name %s',
  (capability) => {
    expect(() => d2Profile.validateCapabilities([capability])).toThrow(
      'Invalid D2-50-00 capabilities',
    );
  },
);

test.each(['', ' ', '\n'])('rejects blank commands %j', (value) => {
  expect(() => d2Profile.parseCommand(context, { value })).toThrow();
  expect(() => d2Profile.entity?.parseCommand(context, 'percentage', value)).toThrow();
});

test('decodes D2-50-00 basic status modes through the profile contract', () => {
  expect(
    d2Profile.decodeIngress(context, {
      RORG: 0xd2,
      payload: [0x41, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0],
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
      payload: [0x4b, 0x03, 0x00, 0x1e, 0x00, 0xc3, 0, 0, 0, 0, 0, 0, 0, 0],
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

test('decodes Type 00 sensor measurements from basic status', () => {
  const result = d2Profile.decodeIngress(context, {
    RORG: 0xd2,
    payload: [0x41, 0x03, 0x02, 0x16, 0x00, 0x9f, 0x50, 0x00, 0x00, 0x44, 0x11, 0x23, 0x41, 0xe0],
    senderId: '05126787',
  });

  expect(result).toMatchObject({
    kind: 'reported',
    reportedState: {
      airQuality: 22,
      filterMaintenance: true,
      outdoorTemperature: 15,
      supplyAirTemperature: 20,
      supplyAirFlow: 17,
      exhaustAirFlow: 17,
      supplyFanSpeed: 564,
      exhaustFanSpeed: 480,
    },
  });
});

test('publishes D2 measurements as Home Assistant sensor attributes', () => {
  const descriptor = d2Profile.entity!.describe(context);
  const state = d2Profile.entity!.projectState({
    ...context,
    reportedState: {
      isOn: true,
      percentage: 25,
      d2Value: 1,
      airQuality: 22,
      filterMaintenance: true,
      outdoorTemperature: 15,
      supplyAirTemperature: 20,
      supplyAirFlow: 0,
      exhaustAirFlow: 68,
      supplyFanSpeed: 564,
      exhaustFanSpeed: 480,
    },
  });

  expect(descriptor.jsonState).toBe(true);
  expect(descriptor.discoveryEntities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'air_quality',
        kind: 'sensor',
        valueTemplate: '{{ value_json.airQuality }}',
        unit: '%',
      }),
      expect.objectContaining({
        key: 'outdoor_temperature',
        valueTemplate: '{{ value_json.outdoorTemperature }}',
        unit: '\u00b0C',
      }),
      expect.objectContaining({
        key: 'exhaust_fan_speed',
        valueTemplate: '{{ value_json.exhaustFanSpeed }}',
        unit: 'rpm',
      }),
      expect.objectContaining({
        key: 'filter_maintenance',
        kind: 'binary_sensor',
        entityCategory: 'diagnostic',
        valueTemplate: "{{ 'ON' if value_json.filterMaintenance else 'OFF' }}",
      }),
    ]),
  );
  expect(state.attributes).toEqual({
    airQuality: 22,
    filterMaintenance: true,
    airQualityThreshold: null,
    co2Threshold: null,
    outdoorTemperature: 15,
    supplyAirTemperature: 20,
    supplyAirFlow: 0,
    exhaustAirFlow: 68,
    supplyFanSpeed: 564,
    exhaustFanSpeed: 480,
    humidityThreshold: null,
    operationMode: 'none',
  });
});

test('encodes D2-50-00 Type 0x00 ventilation controls', () => {
  const command = d2Profile.parseCommand(context, {
    operationMode: 'next',
    timerOperationMode: true,
    co2Threshold: 45,
    humidityThreshold: 61,
    airQualityThreshold: 72,
  });
  const frame = new Esp3Parser().push(d2Profile.encodeCommand(context, command));

  expect(frame[0]?.data).toEqual([0xd2, 0x2f, 0x40, 0xad, 61, 72, 0, 0xff, 0xe7, 0x66, 0x81, 0]);
  expect(command.desiredState).toMatchObject({
    d2Value: 0,
    operationMode: 'none',
    co2Threshold: 45,
    humidityThreshold: 61,
    airQualityThreshold: 72,
  });
});

test('uses device D2 thresholds by default and preserves settings for partial commands', () => {
  const first = d2Profile.parseCommand(context, { airQualityThreshold: 38 });
  const firstFrame = new Esp3Parser().push(d2Profile.encodeCommand(context, first));
  expect(firstFrame[0]?.data.slice(0, 7)).toEqual([0xd2, 0x2f, 0, 0x7f, 0x7f, 38, 0]);

  const nextContext = { ...context, desiredState: first.desiredState };
  const second = d2Profile.parseCommand(nextContext, { humidityThreshold: 55 });
  const secondFrame = new Esp3Parser().push(d2Profile.encodeCommand(nextContext, second));
  expect(secondFrame[0]?.data.slice(0, 7)).toEqual([0xd2, 0x2f, 0, 0x7f, 55, 38, 0]);
});

test('resets custom D2 thresholds to the device defaults', () => {
  const custom = d2Profile.parseCommand(context, {
    co2Threshold: 45,
    humidityThreshold: 61,
    airQualityThreshold: 72,
  });
  const reset = d2Profile.parseCommand(
    { ...context, desiredState: custom.desiredState },
    { resetThresholds: true },
  );
  const frame = new Esp3Parser().push(
    d2Profile.encodeCommand({ ...context, desiredState: custom.desiredState }, reset),
  );

  expect(frame[0]?.data.slice(0, 7)).toEqual([0xd2, 0x2f, 0, 0x7f, 0x7f, 0x7f, 0]);
  expect(reset.desiredState).toMatchObject({
    co2Threshold: null,
    humidityThreshold: null,
    airQualityThreshold: null,
  });
});

test('preserves D2 ventilation settings when changing fan speed', () => {
  const settings = d2Profile.parseCommand(context, { airQualityThreshold: 38 });
  const speed = d2Profile.parseCommand(
    { ...context, desiredState: settings.desiredState },
    { percentage: 75 },
  );
  const frame = new Esp3Parser().push(
    d2Profile.encodeCommand({ ...context, desiredState: settings.desiredState }, speed),
  );

  expect(frame[0]?.data.slice(0, 7)).toEqual([0xd2, 0x23, 0, 0x7f, 0x7f, 38, 0]);
  expect(speed.desiredState).toMatchObject({ d2Value: 3, airQualityThreshold: 38 });
});

test('rejects invalid D2 ventilation control settings', () => {
  expect(() => d2Profile.parseCommand(context, { airQualityThreshold: 101 })).toThrow(
    'air quality threshold',
  );
  expect(() => d2Profile.parseCommand(context, { timerOperationMode: false })).toThrow(
    'timer operation mode',
  );
});

test('describes D2 ventilation control settings and Home Assistant threshold entities', () => {
  const descriptor = d2Profile.entity!.describe(context);

  expect(descriptor.controls).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ field: 'operationMode', kind: 'select' }),
      expect.objectContaining({ field: 'co2Threshold', kind: 'number', nullable: true }),
      expect.objectContaining({ field: 'humidityThreshold', kind: 'number', nullable: true }),
      expect.objectContaining({ field: 'airQualityThreshold', kind: 'number', nullable: true }),
      expect.objectContaining({ field: 'timerOperationMode', kind: 'action' }),
      expect.objectContaining({ field: 'resetThresholds', kind: 'action' }),
    ]),
  );
  expect(descriptor.discoveryEntities).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        key: 'air_quality_threshold',
        kind: 'number',
        commandTemplate: '{"airQualityThreshold":{{ value }}}',
      }),
      expect.objectContaining({
        key: 'operation_mode',
        kind: 'select',
        options: ['none', 'next', 'previous'],
        commandTemplate: '{"operationMode":"{{ value }}"}',
      }),
      expect.objectContaining({
        key: 'timer_operation_mode',
        kind: 'button',
        commandTemplate: '{"timerOperationMode":true}',
      }),
      expect.objectContaining({
        key: 'reset_thresholds',
        kind: 'button',
        commandTemplate: '{"resetThresholds":true}',
      }),
    ]),
  );
});

test('parses a command and encodes the D2 ERP1 frame through the profile contract', () => {
  const command = d2Profile.parseCommand(context, { percentage: 75 });
  const frame = d2Profile.encodeCommand(context, command);

  expect(command).toMatchObject({ value: 3, desiredState: { d2Value: 3, percentage: 75 } });
  expect(Array.from(frame.slice(6, 13))).toEqual([0xd2, 0x23, 0, 0x7f, 0x7f, 0x7f, 0]);
});

test('uses the assigned device source ID when addressing a command', () => {
  const commandContext = {
    ...context,
    sourceId: 0xffe76682,
  };
  const command = d2Profile.parseCommand(commandContext, { percentage: 75 });
  const frame = d2Profile.encodeCommand(commandContext, command);

  expect(Array.from(frame.slice(13, 17))).toEqual([0xff, 0xe7, 0x66, 0x82]);
  expect(Array.from(frame.slice(19, 23))).toEqual([0x05, 0x12, 0x67, 0x87]);
});

test.each([0, 1, 2, 3, 4, 11, 12, 13, 14, 15])(
  'encodes a valid control telegram for mode %s',
  (value) => {
    const device = {
      ...context,
      capabilities: [...(context.capabilities as string[]), 'automaticOnDemand'],
    };
    const command = d2Profile.parseCommand(device, { value });
    const frames = new Esp3Parser().push(d2Profile.encodeCommand(device, command));
    expect(frames).toHaveLength(1);
    expect(frames[0].data).toEqual([
      0xd2,
      0x20 | value,
      0,
      0x7f,
      0x7f,
      0x7f,
      0,
      0xff,
      0xe7,
      0x66,
      0x81,
      0,
    ]);
    expect(frames[0].optionalData).toEqual([3, 5, 0x12, 0x67, 0x87, 0xff, 0]);
    if (value === 15) expect(command.desiredState).toBeUndefined();
  },
);
test('rejects invalid control values and address bytes', () => {
  for (const value of [5, 10, 16, -1, 1.5, Number.NaN]) {
    expect(() => changeState([1, 2, 3, 4], [5, 6, 7, 8], value)).toThrow('Unsupported');
  }
  expect(() => changeState([1, 2, 3, 256], [5, 6, 7, 8], 1)).toThrow('valid bytes');
});

test('ignores requests, controls, truncated status and reserved modes', () => {
  for (const payload of [
    [],
    [0],
    [1],
    [0xd1],
    [0x23, 0, 0x7f, 0x7f, 0x7f, 0],
    [0x41, 0x03, 0, 0x1e, 0, 0xc3],
    [0x45, ...Array(13).fill(0)],
    [0x4f, ...Array(13).fill(0)],
    [0x41, ...Array(13).fill(256)],
    [0x41, ...Array(14).fill(0)],
  ]) {
    expect(
      d2Profile.decodeIngress(context, { RORG: 0xd2, senderId: context.targetId, payload }),
    ).toEqual({ kind: 'ignored' });
  }
});

test('accepts reported modes independently of enabled commands and ignores reserved bits', () => {
  const device = { ...context, capabilities: ['off', 'level1'] };
  const result = d2Profile.decodeIngress(device, {
    RORG: 0xd2,
    senderId: context.targetId,
    payload: [0x5b, ...Array(13).fill(0)],
  });
  expect(result).toMatchObject({
    kind: 'reported',
    reportedState: { d2Value: 11, preset: 'Automatic' },
  });
  if (result.kind !== 'reported') throw new Error('Expected status');
  expect(() =>
    d2Profile.validateState(result.reportedState, 'reportedState', device.capabilities),
  ).not.toThrow();
  expect(() => d2Profile.parseCommand(device, { value: 11 })).toThrow('does not support');
});
