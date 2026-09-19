import type { Device, EntityState } from '../ui/types';

export function formatTargetId(targetId: number): string {
  return `0x${targetId.toString(16).padStart(8, '0').toUpperCase()}`;
}

export function currentState(device: Device): EntityState {
  return device.entityState ?? { isOn: false };
}

export function formatLastSeen(lastSeen?: string): string {
  if (!lastSeen) return 'N/A';
  const date = new Date(lastSeen);
  return Number.isNaN(date.getTime()) ? lastSeen : date.toLocaleString();
}
