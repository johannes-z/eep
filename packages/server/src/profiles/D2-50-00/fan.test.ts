import { expect, test } from 'bun:test';
import {
  d2ValueToFanState,
  fanPercentageToD2Value,
  fanPresetToD2Value,
  fanSpeedToD2Value,
  parseD2Value,
} from './fan';

test('maps D2 speed values to fan percentages', () => {
  expect(d2ValueToFanState(0)).toMatchObject({ isOn: false, percentage: 0 });
  expect(d2ValueToFanState(1)).toMatchObject({ isOn: true, percentage: 25 });
  expect(d2ValueToFanState(4)).toMatchObject({ isOn: true, percentage: 100 });
});

test('maps D2 operating modes to fan presets', () => {
  expect(d2ValueToFanState(11)).toMatchObject({ preset: 'Automatic', percentage: 0 });
  expect(d2ValueToFanState(12)).toMatchObject({ preset: 'Automatic on demand' });
  expect(d2ValueToFanState(13)).toMatchObject({ preset: 'Supply' });
  expect(d2ValueToFanState(14)).toMatchObject({ preset: 'Exhaust' });
});

test('maps Home Assistant fan commands to D2 values', () => {
  expect(fanPercentageToD2Value(75)).toBe(3);
  expect(fanPercentageToD2Value(54)).toBe(3);
  expect(fanPercentageToD2Value(26)).toBe(2);
  expect(fanPercentageToD2Value(76)).toBe(4);
  expect(fanSpeedToD2Value(3)).toBe(3);
  expect(() => fanSpeedToD2Value(54)).toThrow();
  expect(fanPresetToD2Value('Automatic on demand')).toBe(12);
  expect(parseD2Value('15')).toBe(15);
  expect(() => parseD2Value('10')).toThrow();
  expect(() => d2ValueToFanState(15)).toThrow();
  expect(() => fanPercentageToD2Value(101)).toThrow();
});

test('maps a three-speed device to contiguous Home Assistant speeds', () => {
  const supportedFunctions = ['off', 'level1', 'level2', 'level3'];

  expect(fanPercentageToD2Value(100, supportedFunctions)).toBe(3);
  expect(fanSpeedToD2Value(3, supportedFunctions)).toBe(3);
  expect(d2ValueToFanState(3, 0, supportedFunctions)).toMatchObject({
    percentage: 100,
  });
  expect(() => fanSpeedToD2Value(4, supportedFunctions)).toThrow();
});
