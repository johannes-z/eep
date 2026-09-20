import type {
  Device,
  GeneralSettings,
  HomeAssistantSettings,
  LogLevel,
  TransportSettings,
} from '../config';
import { validateMqttConfig } from '../config';
import type { MqttSettings } from '../mqtt';
import { parseEnOceanId } from '../util';

export interface MqttStatus {
  connected: boolean;
  error?: string;
}

const usb300ChannelCount = 127;

export function mqttSettingsResponse(
  settings: MqttSettings,
  status: MqttStatus = { connected: false },
  discoveryTopic = settings.discoveryPrefix ?? 'homeassistant',
): Record<string, unknown> {
  return {
    configured: Boolean(settings.url),
    connected: status.connected,
    error: status.error ?? '',
    server: settings.url,
    user: settings.username ?? '',
    password: '',
    passwordConfigured: Boolean(settings.password),
    base_topic: settings.baseTopic ?? 'eep',
    discovery_prefix: discoveryTopic,
    client_id: settings.clientId ?? '',
    keepalive: settings.keepalive ?? 60,
    version: settings.version ?? 4,
    maximum_packet_size: settings.maximumPacketSize ?? 1048576,
    tls: settings.tls ?? false,
    ca: settings.ca ?? '',
    cert: settings.cert ?? '',
    key: settings.key ?? '',
    reject_unauthorized: settings.rejectUnauthorized ?? true,
    force_disable_retain: settings.forceDisableRetain ?? false,
    include_device_information: settings.includeDeviceInformation ?? true,
  };
}

export function transportSettingsResponse(
  settings: TransportSettings,
  connected: boolean,
): Record<string, unknown> {
  return {
    connected,
    type: settings.type,
    port: settings.path,
    baudrate: settings.baudRate,
    rtscts: settings.rtscts,
  };
}

export function homeAssistantSettingsResponse(
  settings: HomeAssistantSettings,
): Record<string, unknown> {
  return {
    enabled: settings.enabled,
    discovery_topic: settings.discoveryTopic,
    status_topic: settings.statusTopic,
    log_level: settings.logLevel ?? 'info',
  };
}

export function generalSettingsResponse(
  settings: GeneralSettings,
  baseId: number | undefined,
  devices: readonly Device[],
): Record<string, unknown> {
  const devicesBySourceId = new Map(devices.map((device) => [device.sourceId, device]));
  return {
    start_id: settings.startId.toString(16).padStart(8, '0'),
    base_id: baseId === undefined ? null : baseId.toString(16).padStart(8, '0'),
    channels:
      baseId === undefined
        ? []
        : Array.from({ length: usb300ChannelCount }, (_, index) => {
            const channel = index + 1;
            const sourceId = baseId + channel;
            const device = devicesBySourceId.get(sourceId);
            return {
              channel,
              id: sourceId.toString(16).padStart(8, '0'),
              used: device !== undefined,
              ...(device ? { device: device.name } : {}),
            };
          }),
  };
}

function readString(
  body: Record<string, unknown>,
  key: string,
  fallback: string | undefined,
): string | undefined {
  if (!(key in body)) return fallback;
  if (typeof body[key] !== 'string') throw new Error(`${key} must be a string`);
  const value = body[key].trim();
  return value || undefined;
}

function readText(body: Record<string, unknown>, key: string, fallback: string): string {
  if (!(key in body)) return fallback;
  if (typeof body[key] !== 'string') throw new Error(`${key} must be a string`);
  return body[key].trim();
}

function readBoolean(
  body: Record<string, unknown>,
  key: string,
  fallback: boolean | undefined,
): boolean | undefined {
  if (!(key in body)) return fallback;
  if (typeof body[key] !== 'boolean') throw new Error(`${key} must be a boolean`);
  return body[key];
}

function readInteger(
  body: Record<string, unknown>,
  key: string,
  fallback: number | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (!(key in body)) return fallback;
  const value = body[key];
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return number;
}

function readLogLevel(body: Record<string, unknown>, key: string, fallback: LogLevel): LogLevel {
  const value = readText(body, key, fallback);
  if (value !== 'debug' && value !== 'info' && value !== 'warn' && value !== 'error') {
    throw new Error(`${key} must be debug, info, warn, or error`);
  }
  return value;
}

export function parseMqttSettings(
  body: Record<string, unknown>,
  current: MqttSettings,
): MqttSettings {
  const next: MqttSettings = { ...current };
  const server = body.server;
  if (server !== undefined) {
    if (typeof server !== 'string') throw new Error('server must be a string');
    next.url = server.trim();
  }
  next.username = readString(body, 'user', current.username);
  next.baseTopic = readString(body, 'base_topic', current.baseTopic);
  next.discoveryPrefix = readString(body, 'discovery_prefix', current.discoveryPrefix);
  next.clientId = readString(body, 'client_id', current.clientId);
  next.ca = readString(body, 'ca', current.ca);
  next.cert = readString(body, 'cert', current.cert);
  next.key = readString(body, 'key', current.key);
  if (body.clear_password !== undefined && typeof body.clear_password !== 'boolean') {
    throw new Error('clear_password must be a boolean');
  }
  if (body.clear_password === true) next.password = undefined;
  else if (body.password !== undefined) {
    if (typeof body.password !== 'string') throw new Error('password must be a string');
    if (body.password) next.password = body.password;
  }
  next.keepalive = readInteger(body, 'keepalive', current.keepalive, 0, 65535);
  next.maximumPacketSize = readInteger(
    body,
    'maximum_packet_size',
    current.maximumPacketSize,
    1,
    268435460,
  );
  next.version = readInteger(body, 'version', current.version, 3, 5) as 3 | 4 | 5 | undefined;
  next.tls = readBoolean(body, 'tls', current.tls);
  next.rejectUnauthorized = readBoolean(body, 'reject_unauthorized', current.rejectUnauthorized);
  next.forceDisableRetain = readBoolean(body, 'force_disable_retain', current.forceDisableRetain);
  next.includeDeviceInformation = readBoolean(
    body,
    'include_device_information',
    current.includeDeviceInformation,
  );
  validateMqttConfig(next);
  return next;
}

export function parseTransportSettings(
  body: Record<string, unknown>,
  current: TransportSettings,
): TransportSettings {
  const type = readText(body, 'type', current.type);
  if (type !== 'none' && type !== 'serial' && type !== 'tcp') {
    throw new Error('type must be none, serial, or tcp');
  }
  const next: TransportSettings = {
    type,
    path: readText(body, 'port', current.path),
    baudRate: readInteger(body, 'baudrate', current.baudRate, 1, 4_000_000) ?? current.baudRate,
    rtscts: readBoolean(body, 'rtscts', current.rtscts) ?? current.rtscts,
  };
  if (next.type !== 'none' && !next.path) {
    throw new Error('port is required when a transport is configured');
  }
  if (next.type === 'tcp' && !next.path.startsWith('tcp://')) {
    throw new Error('port must start with tcp:// for a TCP transport');
  }
  return next;
}

export function parseHomeAssistantSettings(
  body: Record<string, unknown>,
  current: HomeAssistantSettings,
): HomeAssistantSettings {
  const next = {
    enabled: readBoolean(body, 'enabled', current.enabled) ?? current.enabled,
    discoveryTopic: readText(body, 'discovery_topic', current.discoveryTopic),
    statusTopic: readText(body, 'status_topic', current.statusTopic),
    logLevel: readLogLevel(body, 'log_level', current.logLevel ?? 'info'),
  };
  if (!next.discoveryTopic) throw new Error('discovery_topic must not be empty');
  if (!next.statusTopic) throw new Error('status_topic must not be empty');
  return next;
}

export function parseGeneralSettings(
  body: Record<string, unknown>,
  current: GeneralSettings,
): GeneralSettings {
  if (!('start_id' in body)) return current;
  const parsed = parseEnOceanId(body.start_id);
  if (parsed === undefined || parsed < 1) {
    throw new Error('start_id must be a non-zero EnOcean identifier');
  }
  return { startId: parsed };
}

export function parseRouteId(value: string): number {
  return parseEnOceanId(value) ?? Number.NaN;
}
