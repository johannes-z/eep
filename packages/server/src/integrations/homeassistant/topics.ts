import type { Device } from '../../config';

export interface EntityTopics {
  id: string;
  discovery: string;
  base: string;
  bridgeAvailability: string;
  command: string;
  percentageCommand: string;
  presetCommand: string;
  state: string;
  percentageState: string;
  presetState: string;
  availability: string;
}

export interface PermitJoinTopics {
  discovery: string;
  command: string;
  state: string;
  bridgeAvailability: string;
}

export interface RestartTopics {
  discovery: string;
  command: string;
  bridgeAvailability: string;
}

export type DeviceDiagnosticField = 'sender_id' | 'target_id' | 'eep';

export interface DeviceDiagnosticTopics {
  discovery: string;
  state: string;
  availability: string;
  bridgeAvailability: string;
}

export function deviceId(device: Device): string {
  return device.sourceId.toString(16).padStart(8, '0');
}

function nameObjectId(name: string): string {
  const objectId = name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return objectId;
}

export function entityObjectId(device: Device): string {
  return nameObjectId(device.name) || `eep_${deviceId(device)}`;
}

export function entityTopics(
  device: Device,
  kind: string,
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): EntityTopics {
  const id = deviceId(device);
  const base = `${baseTopic}/${kind}/${id}`;
  return {
    id,
    discovery: `${discoveryPrefix}/${kind}/${id}/config`,
    base,
    bridgeAvailability,
    command: `${base}/command`,
    percentageCommand: `${base}/percentage/set`,
    presetCommand: `${base}/preset/set`,
    state: `${base}/state`,
    percentageState: `${base}/percentage/state`,
    presetState: `${base}/preset/state`,
    availability: `${base}/availability`,
  };
}

export function permitJoinTopics(
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): PermitJoinTopics {
  const base = `${baseTopic}/permit_join`;
  return {
    discovery: `${discoveryPrefix}/switch/permit_join/config`,
    command: `${base}/set`,
    state: `${base}/state`,
    bridgeAvailability,
  };
}

export function restartTopics(
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): RestartTopics {
  return {
    discovery: `${discoveryPrefix}/button/restart/config`,
    command: `${baseTopic}/restart/set`,
    bridgeAvailability,
  };
}

export function deviceDiagnosticTopics(
  device: Device,
  field: DeviceDiagnosticField,
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): DeviceDiagnosticTopics {
  const id = deviceId(device);
  const base = `${baseTopic}/device/${id}/${field}`;
  return {
    discovery: `${discoveryPrefix}/sensor/eep_${id}_${field}/config`,
    state: `${base}/state`,
    availability: `${base}/availability`,
    bridgeAvailability,
  };
}
