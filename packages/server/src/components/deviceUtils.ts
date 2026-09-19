import type { Device, FanState } from '../ui/types';

export function formatTargetId(targetId: number): string {
  return `0x${targetId.toString(16).padStart(8, '0').toUpperCase()}`;
}

export function currentState(device: Device): FanState {
  if (device.desiredState && device.desiredState.d2Value !== device.reportedState?.d2Value) {
    return device.desiredState;
  }
  return device.reportedState ?? device.desiredState ?? { isOn: false, percentage: 0, d2Value: 0 };
}

export function formatLastSeen(lastSeen?: string): string {
  if (!lastSeen) return 'N/A';
  const date = new Date(lastSeen);
  return Number.isNaN(date.getTime()) ? lastSeen : date.toLocaleString();
}
