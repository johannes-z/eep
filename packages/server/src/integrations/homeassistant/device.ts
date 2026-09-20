import type { Device } from '../../devices/types';
import { type DeviceDiagnosticField } from './topics';

export const bridgeDeviceId = 'eep_bridge';

export type DeviceAvailability = 'online' | 'offline';

export function deviceAvailability(device: Device): DeviceAvailability {
  return device.availability === 'online' ? 'online' : 'offline';
}

export function diagnosticValues(
  device: Device,
): Array<{ field: DeviceDiagnosticField; name: string; value: string }> {
  return [
    {
      field: 'sender_id',
      name: 'Sender ID',
      value: device.targetId.toString(16).padStart(8, '0'),
    },
    {
      field: 'target_id',
      name: 'Target ID',
      value: device.sourceId.toString(16).padStart(8, '0'),
    },
    { field: 'eep', name: 'EEP', value: device.teachIn?.eep ?? device.profileId },
  ];
}

export function deviceInfo(device: Device, model: string): Record<string, unknown> {
  const id = device.sourceId.toString(16).padStart(8, '0');
  return {
    identifiers: [`eep_${id}`],
    name: device.name,
    manufacturer: 'EnOcean',
    model,
    via_device: bridgeDeviceId,
  };
}

export function bridgeDeviceInfo(): Record<string, unknown> {
  return {
    identifiers: [bridgeDeviceId],
    name: 'Enocean2MQTT Bridge',
    manufacturer: 'Enocean2MQTT',
    model: 'Bridge',
  };
}
