import { deviceTransmitId, type Device } from './types';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import type { DeviceRegistry } from './registry';
import type { TransportConnection } from '../transport/adapters';
import type { RadioERP1Packet } from './inbound';
import { parseEnOceanId } from '../util';

export type TransmitListener = (payload: Uint8Array) => void | Promise<void>;

export async function sendDeviceCommand(
  socket: TransportConnection,
  registry: DeviceRegistry,
  device: Device,
  request: unknown,
  profiles: ProfileRegistry = createDefaultProfileRegistry(),
  onTransmit?: TransmitListener,
): Promise<void> {
  const profile = profiles.require(device.profileId);
  const sourceId = deviceTransmitId(device);
  if (profile.receiveOnly || sourceId === undefined) {
    throw new Error(`${device.profileId} device is read-only`);
  }
  const context = { ...device, sourceId };
  const command = profile.parseCommand(context, request);
  const payload = profile.encodeCommand(context, command);
  if (profile.commandDelivery !== 'onReceive') {
    await socket.write(payload);
    await onTransmit?.(payload);
  }
  if (command.desiredState !== undefined) {
    await registry.update(device.sourceId, {
      desiredState: command.desiredState,
    });
  }
}

export async function replyToRadioPacket(
  socket: TransportConnection,
  registry: DeviceRegistry,
  packet: RadioERP1Packet,
  profiles: ProfileRegistry = createDefaultProfileRegistry(),
  onTransmit?: TransmitListener,
): Promise<void> {
  const targetId = parseEnOceanId(packet.senderId);
  if (targetId === undefined) return;
  const device = registry.findByTargetId(targetId);
  if (!device) return;
  const sourceId = deviceTransmitId(device);
  const profile = profiles.get(device.profileId);
  const destinationId = parseEnOceanId(packet.destinationId);
  if (
    sourceId === undefined ||
    profile?.receiveOnly ||
    !profile?.replyOnReceive ||
    (destinationId !== undefined && destinationId !== 0xffffffff && destinationId !== sourceId)
  )
    return;
  const context = { ...device, sourceId };
  const command = profile.replyOnReceive(context, packet);
  if (!command) return;
  const payload = profile.encodeCommand(context, command);
  await socket.write(payload);
  if (command.desiredState !== undefined) {
    await registry.updateDesiredStateIfUnchanged(
      device.sourceId,
      device.desiredState,
      command.desiredState,
    );
  }
  await onTransmit?.(payload);
}
