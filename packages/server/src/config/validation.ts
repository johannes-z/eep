import type { HomeAssistantSettings, MqttConfig, TransportSettings } from './types';
import { parseTcpPath } from '../util/socketPath';

export const maximumMqttPacketSize = 268_435_460;

function validateOptionalBoolean(value: unknown, name: string): void {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new Error(`${name} must be a boolean`);
  }
}

function validateTopic(value: unknown, name: string): void {
  if (value === undefined) return;
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.includes('#') ||
    value.includes('+') ||
    value.includes('\0')
  ) {
    throw new Error(`${name} must be a non-empty MQTT topic without wildcards`);
  }
}

export function validateMqttConfig(settings: MqttConfig): void {
  if (settings.url !== undefined && settings.url !== '') {
    let url: URL;
    try {
      url = new URL(settings.url);
    } catch {
      throw new Error('MQTT URL must be a valid mqtt:// or mqtts:// URL');
    }
    if (url.protocol !== 'mqtt:' && url.protocol !== 'mqtts:') {
      throw new Error('MQTT URL must use mqtt:// or mqtts://');
    }
    if (!url.hostname) throw new Error('MQTT URL must include a host');
  }
  for (const [value, name] of [
    [settings.username, 'username'],
    [settings.password, 'password'],
    [settings.ca, 'ca'],
    [settings.cert, 'cert'],
    [settings.key, 'key'],
  ] as const) {
    if (value !== undefined && typeof value !== 'string')
      throw new Error(`${name} must be a string`);
  }
  validateTopic(settings.baseTopic, 'baseTopic');
  if (settings.clientId !== undefined && typeof settings.clientId !== 'string') {
    throw new Error('clientId must be a string');
  }
  if (
    settings.keepalive !== undefined &&
    (!Number.isInteger(settings.keepalive) || settings.keepalive < 0 || settings.keepalive > 65_535)
  ) {
    throw new Error('keepalive must be an integer between 0 and 65535');
  }
  if (
    settings.maximumPacketSize !== undefined &&
    (!Number.isInteger(settings.maximumPacketSize) ||
      settings.maximumPacketSize < 1 ||
      settings.maximumPacketSize > maximumMqttPacketSize)
  ) {
    throw new Error(`maximumPacketSize must be an integer between 1 and ${maximumMqttPacketSize}`);
  }
  if (settings.version !== undefined && ![3, 4, 5].includes(settings.version)) {
    throw new Error('version must be 3, 4, or 5');
  }
  validateOptionalBoolean(settings.tls, 'tls');
  validateOptionalBoolean(settings.rejectUnauthorized, 'rejectUnauthorized');
  validateOptionalBoolean(settings.forceDisableRetain, 'forceDisableRetain');
  validateOptionalBoolean(settings.includeDeviceInformation, 'includeDeviceInformation');
}

export function validateTransportSettings(transport: TransportSettings): void {
  if (!['none', 'serial', 'tcp'].includes(transport.type)) {
    throw new Error('TRANSPORT_TYPE must be one of none, serial, or tcp');
  }
  if (transport.type !== 'none' && !transport.path) {
    throw new Error('A transport path is required when a transport is configured');
  }
  if (transport.type === 'tcp') parseTcpPath(transport.path);
  if (transport.type === 'serial' && transport.path.startsWith('tcp://')) {
    throw new Error('A serial transport cannot use a tcp:// path');
  }
}

export function validateHomeAssistantSettings(settings: HomeAssistantSettings): void {
  validateTopic(settings.discoveryTopic, 'discoveryTopic');
  validateTopic(settings.statusTopic, 'statusTopic');
}
