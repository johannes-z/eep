import { deviceTransmitId, type Device } from './types';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import type { DeviceRegistry } from './registry';
import type { TransportConnection } from '../transport/adapters';

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
  await socket.write(payload);
  await onTransmit?.(payload);
  if (command.desiredState !== undefined) {
    await registry.update(device.sourceId, {
      desiredState: command.desiredState,
    });
  }
}
