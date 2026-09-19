import type { Device } from '../config';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import type { DeviceRegistry } from './registry';

export type UteDirection = 'unidirectional' | 'bidirectional';
export type UteRequestType = 'teachIn' | 'teachOut' | 'unspecified' | 'reserved';
export type UteCommand = 'query' | 'response' | 'reserved';

export interface UteTeachInInfo {
  control: number;
  channel: number;
  manufacturer: number;
  eep: string;
  direction: UteDirection;
  responseExpected: boolean;
  requestType: UteRequestType;
  command: UteCommand;
}

export interface RadioERP1Packet {
  RORG: number;
  payload: ArrayLike<number>;
  senderId: string | number;
  teachIn?: boolean;
  teachInInfo?: UteTeachInInfo;
}

export interface InboundStateResult {
  device: Device;
  value?: unknown;
}

function parseSenderId(senderId: string | number): number {
  if (typeof senderId === 'number') return senderId;
  const value = Number.parseInt(senderId, 16);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Invalid EnOcean sender ID: ${senderId}`);
  }
  return value;
}

export async function applyRadioPacket(
  packet: RadioERP1Packet,
  registry: DeviceRegistry,
  profiles: ProfileRegistry = createDefaultProfileRegistry(),
): Promise<InboundStateResult | undefined> {
  const targetId = parseSenderId(packet.senderId);
  const device = registry.findByTargetId(targetId);
  if (!device) return undefined;

  const profile = profiles.get(device.profileId);
  if (!profile) return undefined;
  const result = profile.decodeIngress(
    {
      sourceId: device.sourceId,
      targetId: device.targetId,
      capabilities: device.capabilities,
      reportedState: device.reportedState,
      desiredState: device.desiredState,
    },
    packet,
  );
  if (result.kind !== 'reported') return undefined;
  await registry.update(targetId, {
    availability: 'online',
    lastSeen: new Date().toISOString(),
    reportedState: result.reportedState as Device['reportedState'],
    ...(result.clearDesiredState ? { desiredState: undefined } : {}),
  });
  return { device: registry.findByTargetId(targetId) as Device, value: result.value };
}
