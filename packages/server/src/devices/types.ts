import type { JsonValue } from '../profiles/types';

export interface DeviceTeachInInfo {
  eep: string;
  channel?: number;
  manufacturerId?: number;
  direction: 'unidirectional' | 'bidirectional';
  responseExpected: boolean;
}

export interface Device {
  sourceId: number;
  transmitId?: number | null;
  targetId: number;
  name: string;
  profileId: string;
  capabilities: JsonValue;
  teachIn?: DeviceTeachInInfo;
  lastSeen?: string;
  availability: 'online' | 'offline' | 'unknown';
  reportedState?: unknown;
  desiredState?: unknown;
}

export function deviceTransmitId(device: Device): number | undefined {
  return device.transmitId === null ? undefined : (device.transmitId ?? device.sourceId);
}
