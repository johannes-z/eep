import { d2ValueToFanState, isD2ControlValue } from '../api/D2-50-00/fan';
import type { Device } from '../config';
import type { DeviceRegistry } from './registry';

export interface RadioERP1Packet {
  RORG: number;
  payload: ArrayLike<number>;
  senderId: string | number;
  teachIn?: boolean;
  teachInInfo?: unknown;
}

export interface InboundStateResult {
  device: Device;
  value: number;
}

function parseSenderId(senderId: string | number): number {
  if (typeof senderId === 'number') return senderId;
  const value = Number.parseInt(senderId, 16);
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Invalid EnOcean sender ID: ${senderId}`);
  }
  return value;
}

export function decodeD2Value(payload: ArrayLike<number>): number | undefined {
  if (payload.length === 0) return undefined;
  const firstByte = payload[0];
  if (isD2ControlValue(firstByte)) return firstByte;
  const packedValue = firstByte >> 4;
  return isD2ControlValue(packedValue) ? packedValue : undefined;
}

export async function applyRadioPacket(
  packet: RadioERP1Packet,
  registry: DeviceRegistry,
): Promise<InboundStateResult | undefined> {
  if (packet.RORG !== 0xd2 || packet.teachIn) return undefined;
  const targetId = parseSenderId(packet.senderId);
  const device = registry.findByTargetId(targetId);
  if (!device) return undefined;

  const value = decodeD2Value(packet.payload);
  if (value === undefined || value === 15) return undefined;
  const previousPercentage =
    device.desiredState?.percentage ?? device.reportedState?.percentage ?? 0;
  const reportedState = d2ValueToFanState(value, previousPercentage, device.supportedFunctions);
  const desiredState =
    device.desiredState?.d2Value === reportedState.d2Value ? undefined : device.desiredState;
  await registry.update(targetId, {
    availability: 'online',
    lastSeen: new Date().toISOString(),
    reportedState,
    desiredState,
  });
  return { device: registry.findByTargetId(targetId) as Device, value };
}
