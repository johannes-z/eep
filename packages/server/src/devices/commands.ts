import type { Device } from '../config';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import type { DeviceRegistry } from './registry';
import type { TransportConnection } from '../transport/adapters';

async function writePayload(socket: TransportConnection, payload: Uint8Array): Promise<void> {
  await socket.write(payload);
}

export async function sendDeviceCommand(
  socket: TransportConnection,
  registry: DeviceRegistry | undefined,
  device: Device,
  request: unknown,
  profiles: ProfileRegistry = createDefaultProfileRegistry(),
  senderId?: number,
): Promise<void> {
  const profile = profiles.require(device.profileId);
  const context = {
    sourceId: device.sourceId,
    ...(senderId === undefined ? {} : { senderId }),
    targetId: device.targetId,
    capabilities: device.capabilities,
    reportedState: device.reportedState,
    desiredState: device.desiredState,
  };
  const command = profile.parseCommand(context, normalizeCommandRequest(request));
  const payload = profile.encodeCommand(context, command);
  await writePayload(socket, payload);
  if (registry && command.desiredState !== undefined) {
    await registry.update(device.sourceId, {
      desiredState: command.desiredState as Device['desiredState'],
    });
  }
}

function normalizeCommandRequest(request: unknown): unknown {
  return typeof request === 'number' || typeof request === 'string' ? { value: request } : request;
}

export function assertSupportedDeviceValue(
  device: Device,
  value: number,
  profiles: ProfileRegistry = createDefaultProfileRegistry(),
): void {
  const profile = profiles.require(device.profileId);
  profile.parseCommand(
    {
      sourceId: device.sourceId,
      targetId: device.targetId,
      capabilities: device.capabilities,
      reportedState: device.reportedState,
      desiredState: device.desiredState,
    },
    { value },
  );
}
