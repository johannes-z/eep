import { join } from 'node:path';
import type {
  AddonConfig,
  HomeAssistantSettings,
  LogLevel,
  ServerConfig,
  TransportSettings,
  TransportType,
} from './types';

function parseInteger(
  value: string | number,
  name: string,
  minimum: number,
  maximum: number,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function parseBoolean(value: string | boolean, name: string): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error(`${name} must be true or false`);
}

function environmentInteger(
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const value = process.env[name];
  return value === undefined ? fallback : parseInteger(value, name, minimum, maximum);
}

function environmentBoolean(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  return value === undefined ? fallback : parseBoolean(value, name);
}

function configuredString(value: unknown, name: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string') throw new Error(`${name} must be a string`);
  return value;
}

function configuredBoolean(value: unknown, name: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== 'boolean') throw new Error(`${name} must be a boolean`);
  return value;
}

function configuredLogLevel(value: unknown, name: string, fallback: LogLevel): LogLevel {
  const level = configuredString(value, name, fallback);
  if (level !== 'debug' && level !== 'info' && level !== 'warn' && level !== 'error') {
    throw new Error(`${name} must be debug, info, warn, or error`);
  }
  return level;
}

function inferTransportType(path: string): TransportType {
  if (!path) return 'none';
  return path.startsWith('tcp://') ? 'tcp' : 'serial';
}

function defaultDataDirectory(): string {
  const isSourceConfigDirectory =
    import.meta.dir.endsWith('/config') || import.meta.dir.endsWith('\\config');
  return join(import.meta.dir, isSourceConfigDirectory ? '../../data' : '../data');
}

function validateTransport(transport: TransportSettings): void {
  if (!['none', 'serial', 'tcp'].includes(transport.type)) {
    throw new Error('TRANSPORT_TYPE must be one of none, serial, or tcp');
  }
  if (transport.type !== 'none' && !transport.path) {
    throw new Error('A transport path is required when a transport is configured');
  }
  if (transport.type === 'tcp' && !transport.path.startsWith('tcp://')) {
    throw new Error('A TCP transport requires a tcp:// path');
  }
  if (transport.type === 'serial' && transport.path.startsWith('tcp://')) {
    throw new Error('A serial transport cannot use a tcp:// path');
  }
}

function resolveHomeAssistant(input: AddonConfig): HomeAssistantSettings {
  const configuredHomeAssistant = input.homeAssistant ?? {};
  const homeAssistant: HomeAssistantSettings = {
    enabled: configuredBoolean(
      configuredHomeAssistant.enabled,
      'homeAssistant.enabled',
      environmentBoolean('HA_ENABLED', true),
    ),
    discoveryTopic: configuredString(
      configuredHomeAssistant.discoveryTopic,
      'homeAssistant.discoveryTopic',
      process.env.HA_DISCOVERY_TOPIC ?? 'homeassistant',
    ),
    statusTopic: configuredString(
      configuredHomeAssistant.statusTopic,
      'homeAssistant.statusTopic',
      process.env.HA_STATUS_TOPIC ?? 'eep/status',
    ),
    logLevel: configuredLogLevel(
      configuredHomeAssistant.logLevel,
      'homeAssistant.logLevel',
      (process.env.HA_LOG_LEVEL as LogLevel | undefined) ?? 'info',
    ),
  };
  if (!homeAssistant.discoveryTopic.trim()) throw new Error('HA_DISCOVERY_TOPIC must not be empty');
  if (!homeAssistant.statusTopic.trim()) throw new Error('HA_STATUS_TOPIC must not be empty');
  return homeAssistant;
}

export function resolveServerConfig(input: AddonConfig = {}): ServerConfig {
  const configuredTransport = input.transport ?? {};
  const path = configuredString(
    configuredTransport.path,
    'transport.path',
    process.env.TRANSPORT_PATH ?? '',
  );
  const transport: TransportSettings = {
    type:
      configuredTransport.type ??
      (process.env.TRANSPORT_TYPE as TransportType | undefined) ??
      inferTransportType(path),
    path,
    baudRate:
      configuredTransport.baudRate === undefined
        ? environmentInteger('BAUD_RATE', 57600, 1, 4_000_000)
        : parseInteger(configuredTransport.baudRate, 'baudRate', 1, 4_000_000),
    rtscts: configuredBoolean(
      configuredTransport.rtscts,
      'transport.rtscts',
      environmentBoolean('RTSCTS', false),
    ),
  };
  validateTransport(transport);

  return {
    host: input.host ?? process.env.HOST ?? '127.0.0.1',
    port:
      input.port === undefined
        ? environmentInteger('PORT', 3000, 1, 65_535)
        : parseInteger(input.port, 'port', 1, 65_535),
    dataDir: input.dataDir ?? process.env.DATA_DIR ?? defaultDataDirectory(),
    webRoot: process.env.WEB_ROOT,
    controllerId:
      input.controllerId === undefined
        ? process.env.CONTROLLER_ID === undefined
          ? undefined
          : parseInteger(process.env.CONTROLLER_ID, 'CONTROLLER_ID', 1, 0xffffffff)
        : parseInteger(input.controllerId, 'controllerId', 1, 0xffffffff),
    startId:
      input.startId === undefined
        ? process.env.START_ID === undefined
          ? undefined
          : parseInteger(process.env.START_ID, 'START_ID', 1, 0xffffffff)
        : parseInteger(input.startId, 'startId', 1, 0xffffffff),
    transport,
    homeAssistant: resolveHomeAssistant(input),
    mqtt: input.mqtt,
  };
}
