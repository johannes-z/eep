import type { JsonValue } from '../profiles/types';

export interface DeviceTeachInInfo {
  eep: string;
  channel: number;
  manufacturerId: number;
  direction: 'unidirectional' | 'bidirectional';
  responseExpected: boolean;
}

export interface Device {
  sourceId: number;
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
