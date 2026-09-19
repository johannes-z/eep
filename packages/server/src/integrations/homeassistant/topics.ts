import type { Device } from '../../config';

export interface FanTopics {
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

export function fanObjectId(device: Device): string {
  return `${objectIdPart(device.roomId)}_${objectIdPart(device.key)}`;
}

export function fanTopics(
  device: Device,
  discoveryPrefix: string,
  baseTopic: string,
  bridgeAvailability: string,
): FanTopics {
  const id = deviceId(device);
  const base = `${baseTopic}/fan/${id}`;
  return {
    id,
    discovery: `${discoveryPrefix}/fan/${id}/config`,
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
