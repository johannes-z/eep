import type { Device } from '../../config';
import type { ProfileDeviceContext } from '../../profiles';
import { type DeviceDiagnosticField } from './topics';

export const bridgeDeviceId = 'eep_bridge';

export type DeviceAvailability = 'online' | 'offline';

export function deviceAvailability(device: Device): DeviceAvailability {
  return device.availability === 'online' ? 'online' : 'offline';
}

export function profileContext(device: Device): ProfileDeviceContext {
  return {
    sourceId: device.sourceId,
    targetId: device.targetId,
    capabilities: device.capabilities,
    reportedState: device.reportedState,
    desiredState: device.desiredState,
  };
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

export function isBridgeDiscovery(payload: Buffer): boolean {
  if (!payload.length) return false;
  try {
    const value = JSON.parse(payload.toString()) as Record<string, unknown>;
    const uniqueId = typeof value.unique_id === 'string' ? value.unique_id : '';
    const objectId = typeof value.object_id === 'string' ? value.object_id : '';
    const device = value.device as Record<string, unknown> | undefined;
    const identifiers = Array.isArray(device?.identifiers) ? device.identifiers : [];
    return (
      uniqueId.startsWith('eep_') ||
      objectId.startsWith('eep_') ||
      device?.via_device === bridgeDeviceId ||
      identifiers.includes(bridgeDeviceId) ||
      identifiers.some(
        (identifier) => typeof identifier === 'string' && identifier.startsWith('eep_'),
      )
    );
  } catch {
    return false;
  }
}

export function discoverySourceId(topic: string, discoveryPrefix: string): number | undefined {
  const prefix = `${discoveryPrefix}/`;
  if (!topic.startsWith(prefix)) return undefined;
  const parts = topic.slice(prefix.length).split('/');
  if (parts.length !== 3 || parts[2] !== 'config') return undefined;
  const directId = /^[0-9a-f]{8}$/i.exec(parts[1]);
  const diagnosticId = /^eep_([0-9a-f]{8})(?:_|$)/i.exec(parts[1]);
  const value = directId?.[0] ?? diagnosticId?.[1];
  return value === undefined ? undefined : Number.parseInt(value, 16);
}
