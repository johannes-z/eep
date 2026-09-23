import type { Device } from './types';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import type { DeviceRegistry } from './registry';
import { requireEnOceanId } from '../util';

export type UteDirection = 'unidirectional' | 'bidirectional';
export type UteRequestType = 'teachIn' | 'teachOut' | 'unspecified' | 'reserved';
export type UteCommand = 'query' | 'response' | 'reserved';
export type UteResponseResult =
  | 'general'
  | 'teachInAccepted'
  | 'teachOutAccepted'
  | 'eepNotSupported';

export interface UteTeachInInfo {
  control: number;
  channel: number;
  manufacturer: number;
  eep: string;
  direction: UteDirection;
  responseExpected: boolean;
  requestType: UteRequestType;
  command: UteCommand;
  response?: UteResponseResult;
}

export interface FourBsTeachInInfo {
  eep?: string;
  manufacturer?: number;
  command: 'query' | 'response';
  eepSupported: boolean;
  senderStored: boolean;
}

export interface RadioERP1Packet {
  RORG: number;
  payload: ArrayLike<number>;
  senderId: string | number;
  status?: number;
  destinationId?: string | number;
  teachIn?: boolean;
  teachInInfo?: UteTeachInInfo | FourBsTeachInInfo;
}

export interface InboundStateResult {
  device: Device;
  value?: unknown;
}

export async function applyRadioPacket(
  packet: RadioERP1Packet,
  registry: DeviceRegistry,
  profiles: ProfileRegistry = createDefaultProfileRegistry(),
): Promise<InboundStateResult | undefined> {
  const targetId = requireEnOceanId(packet.senderId, 'EnOcean sender ID');
  const device = registry.findByTargetId(targetId);
  if (!device) return undefined;

  const profile = profiles.get(device.profileId);
  if (!profile) return undefined;
  const result = profile.decodeIngress(device, packet);
  if (result.kind !== 'reported') return undefined;
  const updated = await registry.update(device.sourceId, {
    availability: 'online',
    lastSeen: new Date().toISOString(),
    reportedState: result.reportedState,
    ...(result.clearDesiredState ? { desiredState: undefined } : {}),
  });
  return { device: updated, value: result.value };
}
