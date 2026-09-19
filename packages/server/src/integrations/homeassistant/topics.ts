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

export type FanTopics = EntityTopics;

export interface PermitJoinTopics {
  discovery: string;
  command: string;
  state: string;
  bridgeAvailability: string;
}

export interface BridgeEntityTopics {
  discovery: string;
  state: string;
  command: string;
}

export interface DeviceDiagnosticTopics {
  discovery: string;
  state: string;
  availability: string;
  bridgeAvailability: string;
}

export interface BridgeTopics {
  connection: BridgeEntityTopics;
  version: BridgeEntityTopics;
  logLevel: BridgeEntityTopics;
  restart: BridgeEntityTopics;
}

export const bridgeDeviceId = 'eep_bridge';

export function deviceId(device: Device): string {
  return device.targetId.toString(16).padStart(8, '0');
}

function objectIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function entityObjectId(device: Device): string {
  return `${objectIdPart(device.roomId)}_${objectIdPart(device.key)}`;
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

export function fanObjectId(device: Device): string {
  return entityObjectId(device);
}

export function fanTopics(
  device: Device,
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): FanTopics {
  return entityTopics(device, 'fan', discoveryPrefix, baseTopic, bridgeAvailability);
}

export function bridgeEntityTopics(
  component: string,
  objectId: string,
  discoveryPrefix: string,
  baseTopic: string,
): BridgeEntityTopics {
  const base = `${baseTopic}/bridge/${objectId}`;
  return {
    discovery: `${discoveryPrefix}/${component}/${objectId}/config`,
    state: `${base}/state`,
    command: `${base}/set`,
  };
}

export function deviceDiagnosticTopics(
  device: Device,
  field: string,
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): DeviceDiagnosticTopics {
  const id = deviceId(device);
  const normalizedField = objectIdPart(field);
  const objectId = `eep_${id}_${normalizedField}`;
  const base = `${baseTopic}/device/${id}/${normalizedField}`;
  return {
    discovery: `${discoveryPrefix}/sensor/${objectId}/config`,
    state: `${base}/state`,
    availability: `${base}/availability`,
    bridgeAvailability,
  };
}

export function bridgeTopics(
  discoveryPrefix: string,
  baseTopic: string,
  _bridgeAvailability: string,
): BridgeTopics {
  const sensor = (objectId: string) =>
    bridgeEntityTopics('sensor', objectId, discoveryPrefix, baseTopic);
  const binarySensor = (objectId: string) =>
    bridgeEntityTopics('binary_sensor', objectId, discoveryPrefix, baseTopic);
  return {
    connection: binarySensor('eep_bridge_connection'),
    version: sensor('eep_bridge_version'),
    logLevel: bridgeEntityTopics('select', 'eep_bridge_log_level', discoveryPrefix, baseTopic),
    restart: bridgeEntityTopics('button', 'eep_bridge_restart', discoveryPrefix, baseTopic),
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
