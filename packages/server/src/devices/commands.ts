import { changeState } from '../api/D2-50-00/changeState';
import { d2ValueToFanState } from '../api/D2-50-00/fan';
import { getProtocolFunctionByValue } from '../api/functions';
import type { Device } from '../config';
import type { DeviceRegistry } from './registry';
import type { TransportConnection } from '../transport/adapters';
import { toHex } from '../util/toHex';

async function writePayload(socket: TransportConnection, payload: Uint8Array): Promise<void> {
  await socket.write(payload);
}

export async function sendDeviceCommand(
  socket: TransportConnection,
  registry: DeviceRegistry | undefined,
  device: Device,
  value: number,
): Promise<void> {
  if (device.protocol !== 'D2-50-00') {
    throw new Error(`Unsupported device protocol: ${device.protocol}`);
  }
  assertSupportedDeviceValue(device, value);
  const payload = changeState(toHex(device.sourceId), toHex(device.targetId), value);
  await writePayload(socket, payload);
  if (!registry || value === 15) return;

  const previousPercentage =
    device.desiredState?.percentage ?? device.reportedState?.percentage ?? 0;
  await registry.update(device.targetId, {
    desiredState: d2ValueToFanState(value, previousPercentage, device.supportedFunctions),
  });
}

export function assertSupportedDeviceValue(device: Device, value: number): void {
  if (value === 15) return;
  const functionDefinition = getProtocolFunctionByValue(device.protocol, value);
  if (!functionDefinition || !device.supportedFunctions.includes(functionDefinition.id)) {
    throw new Error(`Device does not support function for value: ${value}`);
  }
}
