import { DirectOperationModeControl } from './DirectOperationModeControl';
import { getProtocolFunctions, getSupportedProtocolFunctions } from './functions';

export const D2_FAN_PRESETS = ['Automatic', 'Automatic on demand', 'Supply', 'Exhaust'] as const;

export type D2FanPreset = (typeof D2_FAN_PRESETS)[number];

export interface D2FanState {
  isOn: boolean;
  percentage: number;
  preset?: D2FanPreset;
  d2Value: number;
}

const presetToValue: Record<D2FanPreset, DirectOperationModeControl> = {
  Automatic: DirectOperationModeControl.Automatic,
  'Automatic on demand': DirectOperationModeControl.AutomaticOnDemand,
  Supply: DirectOperationModeControl.SupplyOnly,
  Exhaust: DirectOperationModeControl.ExhaustOnly,
};

const valueToPreset: Partial<Record<number, D2FanPreset>> = {
  [DirectOperationModeControl.Automatic]: 'Automatic',
  [DirectOperationModeControl.AutomaticOnDemand]: 'Automatic on demand',
  [DirectOperationModeControl.SupplyOnly]: 'Supply',
  [DirectOperationModeControl.ExhaustOnly]: 'Exhaust',
};

const allD2FunctionIds = Object.keys(getProtocolFunctions());

function speedFunctions(supportedFunctions?: readonly string[]) {
  return getSupportedProtocolFunctions(supportedFunctions ?? allD2FunctionIds).filter(
    (item) => item.kind === 'speed',
  );
}

function offFunction(supportedFunctions?: readonly string[]) {
  return getSupportedProtocolFunctions(supportedFunctions ?? allD2FunctionIds).find(
    (item) => item.d2Value === DirectOperationModeControl.Off,
  );
}

function speedPercentage(index: number, count: number): number {
  return Math.round(((index + 1) / count) * 100);
}

export function isD2ControlValue(value: number): value is DirectOperationModeControl {
  return [0, 1, 2, 3, 4, 11, 12, 13, 14, 15].includes(value);
}

export function d2ValueToFanState(
  value: number,
  previousPercentage = 0,
  supportedFunctions?: readonly string[],
): D2FanState {
  if (!isD2ControlValue(value) || value === DirectOperationModeControl.NoAction) {
    throw new Error(`Unsupported D2-50-00 fan state: ${value}`);
  }

  const preset = valueToPreset[value];
  if (preset) {
    return { isOn: true, percentage: previousPercentage, preset, d2Value: value };
  }

  const speeds = speedFunctions(supportedFunctions);
  const speedIndex = speeds.findIndex((item) => item.d2Value === value);
  return {
    isOn: value > DirectOperationModeControl.Off,
    percentage: speedIndex === -1 ? value * 25 : speedPercentage(speedIndex, speeds.length),
    d2Value: value,
  };
}

export function fanPercentageToD2Value(
  percentage: number,
  supportedFunctions?: readonly string[],
): DirectOperationModeControl {
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error(`Unsupported D2-50-00 fan percentage: ${percentage}`);
  }
  const off = offFunction(supportedFunctions);
  const speeds = speedFunctions(supportedFunctions);
  if (!off || !speeds.length) throw new Error('D2-50-00 device has no speed functions');
  if (percentage <= 0) return off.d2Value as DirectOperationModeControl;
  const index = Math.min(speeds.length, Math.ceil((percentage / 100) * speeds.length)) - 1;
  return speeds[index].d2Value as DirectOperationModeControl;
}

export function fanSpeedToD2Value(
  speed: number,
  supportedFunctions?: readonly string[],
): DirectOperationModeControl {
  const off = offFunction(supportedFunctions);
  const speeds = speedFunctions(supportedFunctions);
  if (!Number.isInteger(speed) || speed < 0 || speed > speeds.length || !off) {
    throw new Error(`Unsupported D2-50-00 fan speed: ${speed}`);
  }
  if (speed === 0) return off.d2Value as DirectOperationModeControl;
  return speeds[speed - 1].d2Value as DirectOperationModeControl;
}

export function fanPowerToD2Value(
  isOn: boolean,
  supportedFunctions?: readonly string[],
): DirectOperationModeControl {
  if (!isOn) return fanSpeedToD2Value(0, supportedFunctions);
  const speed = speedFunctions(supportedFunctions)[0];
  if (!speed) throw new Error('D2-50-00 device has no speed functions');
  return speed.d2Value as DirectOperationModeControl;
}

export function fanD2ValueToSpeed(value: number, supportedFunctions?: readonly string[]): number {
  const index = speedFunctions(supportedFunctions).findIndex((item) => item.d2Value === value);
  return index === -1 ? 0 : index + 1;
}

export function fanSpeedCount(supportedFunctions?: readonly string[]): number {
  return speedFunctions(supportedFunctions).length;
}

export function fanSupportedPresets(supportedFunctions?: readonly string[]): D2FanPreset[] {
  return getSupportedProtocolFunctions(supportedFunctions ?? allD2FunctionIds)
    .filter((item) => item.kind === 'preset' && item.preset)
    .map((item) => item.preset as D2FanPreset);
}

export function fanPresetToD2Value(preset: string): DirectOperationModeControl {
  const value = D2_FAN_PRESETS.includes(preset as D2FanPreset)
    ? presetToValue[preset as D2FanPreset]
    : undefined;
  if (value === undefined) throw new Error(`Unsupported D2-50-00 fan preset: ${preset}`);
  return value;
}

export function parseD2Value(value: string | number): DirectOperationModeControl {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (
    (typeof value === 'string' && !value.trim()) ||
    !Number.isInteger(parsed) ||
    !isD2ControlValue(parsed)
  ) {
    throw new Error(`Unsupported D2-50-00 value: ${value}`);
  }
  return parsed;
}
