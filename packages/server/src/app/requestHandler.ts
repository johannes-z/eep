import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import {
  fanPercentageToD2Value,
  fanPowerToD2Value,
  fanPresetToD2Value,
  parseD2Value,
} from '../api/D2-50-00/fan';
import { resolveServerConfig, validateMqttConfig } from '../config';
import type { Device, HomeAssistantSettings, TransportSettings } from '../config';
import { sendDeviceCommand } from '../devices/commands';
import { initialDevices } from '../devices/registry';
import type { DeviceRegistry } from '../devices/registry';
import type { TeachInManager } from '../devices/teachin';
import { defaultMqttSettings, type MqttSettings } from '../mqtt';
import type { TransportConnection } from '../transport/adapters';
import type { PacketListener } from '../transport/listener';

export interface RequestTransport extends TransportConnection {}

export interface MqttStatus {
  connected: boolean;
  error?: string;
}

export interface RequestHandlerOptions {
  registry?: DeviceRegistry;
  teachIn?: TeachInManager;
  webRoot?: string;
  transportSettings?: TransportSettings;
  saveTransportSettings?: (settings: TransportSettings) => Promise<void>;
  applyTransportSettings?: (settings: TransportSettings) => Promise<void>;
  homeAssistantSettings?: HomeAssistantSettings;
  saveHomeAssistantSettings?: (settings: HomeAssistantSettings) => Promise<void>;
  applyHomeAssistantSettings?: (settings: HomeAssistantSettings) => Promise<void>;
  mqttSettings?: MqttSettings;
  saveMqttSettings?: (settings: MqttSettings) => Promise<void>;
  applyMqttSettings?: (settings: MqttSettings) => Promise<void>;
  mqttStatus?: () => MqttStatus;
  listener?: PacketListener;
}

interface PairingState {
  active: boolean;
  candidates: unknown[];
}

const compatibilityNames: Record<string, number> = {
  auto: 11,
  automatic: 11,
  'automatic-on-demand': 12,
  intake: 13,
  supply: 13,
  exhaust: 14,
  'no-action': 15,
};

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function mqttSettingsResponse(
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

function transportSettingsResponse(settings: TransportSettings): Record<string, unknown> {
  return {
    type: settings.type,
    adapter: settings.adapter,
    port: settings.path,
    baudrate: settings.baudRate,
    disable_led: settings.disableLed,
    rtscts: settings.rtscts,
  };
}

function homeAssistantSettingsResponse(settings: HomeAssistantSettings): Record<string, unknown> {
  return {
    enabled: settings.enabled,
    discovery_topic: settings.discoveryTopic,
    status_topic: settings.statusTopic,
    experimental_event_entities: settings.experimentalEventEntities,
    legacy_action_sensor: settings.legacyActionSensor,
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

function parseMqttSettings(body: Record<string, unknown>, current: MqttSettings): MqttSettings {
  const next: MqttSettings = { ...current };
  const server = body.server ?? body.url;
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

function parseTransportSettings(
  body: Record<string, unknown>,
  current: TransportSettings,
): TransportSettings {
  const type = readText(body, 'type', current.type);
  if (type !== 'none' && type !== 'serial' && type !== 'tcp') {
    throw new Error('type must be none, serial, or tcp');
  }
  const next: TransportSettings = {
    type,
    adapter: readText(body, 'adapter', current.adapter),
    path: readText(body, 'port', current.path),
    baudRate: readInteger(body, 'baudrate', current.baudRate, 1, 4_000_000) ?? current.baudRate,
    disableLed: readBoolean(body, 'disable_led', current.disableLed) ?? current.disableLed,
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

function parseHomeAssistantSettings(
  body: Record<string, unknown>,
  current: HomeAssistantSettings,
): HomeAssistantSettings {
  const next = {
    enabled: readBoolean(body, 'enabled', current.enabled) ?? current.enabled,
    discoveryTopic: readText(body, 'discovery_topic', current.discoveryTopic),
    statusTopic: readText(body, 'status_topic', current.statusTopic),
    experimentalEventEntities:
      readBoolean(body, 'experimental_event_entities', current.experimentalEventEntities) ??
      current.experimentalEventEntities,
    legacyActionSensor:
      readBoolean(body, 'legacy_action_sensor', current.legacyActionSensor) ??
      current.legacyActionSensor,
  };
  if (!next.discoveryTopic) throw new Error('discovery_topic must not be empty');
  if (!next.statusTopic) throw new Error('status_topic must not be empty');
  if (next.experimentalEventEntities || next.legacyActionSensor) {
    throw new Error('event entities and legacy action sensors are not supported yet');
  }
  return next;
}

function parseCommandValue(value: unknown): number {
  if (typeof value === 'string') {
    const namedValue = compatibilityNames[value.toLowerCase()];
    return namedValue === undefined ? parseD2Value(value) : namedValue;
  }
  return parseD2Value(value as number);
}

async function parseCommandBody(request: Request, device: Device): Promise<number> {
  const rawBody: unknown = await request.json();
  if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
    throw new Error('Command body must be an object');
  }
  const body = rawBody as Record<string, unknown>;

  if ('value' in body) {
    if (typeof body.value !== 'string' && typeof body.value !== 'number') {
      throw new Error('value must be a string or number');
    }
    return parseCommandValue(body.value);
  }
  if ('preset' in body) {
    if (typeof body.preset !== 'string') throw new Error('preset must be a string');
    return fanPresetToD2Value(body.preset);
  }
  if ('percentage' in body) {
    if (typeof body.percentage !== 'number') throw new Error('percentage must be a number');
    return fanPercentageToD2Value(body.percentage, device.supportedFunctions);
  }
  if ('isOn' in body) {
    if (typeof body.isOn !== 'boolean') throw new Error('isOn must be a boolean');
    return fanPowerToD2Value(body.isOn, device.supportedFunctions);
  }
  throw new Error('Expected value, percentage, preset, or isOn');
}

function findLegacyDevice(room: string, key: string): Device | undefined {
  const device = initialDevices.find(
    (item) =>
      item.roomId.toUpperCase() === room.toUpperCase() &&
      item.key.toUpperCase() === key.toUpperCase(),
  );
  return device ? { ...device } : undefined;
}

function contentType(path: string): string {
  switch (extname(path)) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    default:
      return 'application/octet-stream';
  }
}

export function createRequestHandler(
  socket: RequestTransport | (() => RequestTransport),
  options: RequestHandlerOptions = {},
) {
  const pairing: PairingState = { active: false, candidates: [] };
  const sourceAppDirectory = import.meta.dir.endsWith('/app') || import.meta.dir.endsWith('\\app');
  const webRoot = resolve(
    options.webRoot ?? join(import.meta.dir, sourceAppDirectory ? '../../public' : '../public'),
  );
  const defaults = resolveServerConfig();
  let transportSettings = options.transportSettings ?? defaults.transport;
  let homeAssistantSettings = options.homeAssistantSettings ?? defaults.homeAssistant;
  let mqttSettings = { ...(options.mqttSettings ?? defaultMqttSettings()) };
  const getSocket = typeof socket === 'function' ? socket : () => socket;

  async function sendCommand(device: Device, value: number): Promise<void> {
    await sendDeviceCommand(getSocket(), options.registry, device, value);
  }

  return async function handleRequest(request: Request): Promise<Response> {
    let parts: string[];
    try {
      parts = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return new Response(null, { status: 400 });
    }

    if (parts[0] === 'api') {
      if (parts[1] === 'settings' && request.method === 'GET' && parts.length === 2) {
        return json(transportSettingsResponse(transportSettings));
      }

      if (parts[1] === 'settings' && request.method === 'PUT' && parts.length === 2) {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const next = parseTransportSettings(body, transportSettings);
          await options.applyTransportSettings?.(next);
          try {
            await options.saveTransportSettings?.(next);
          } catch (error) {
            await options.applyTransportSettings?.(transportSettings).catch(() => undefined);
            throw error;
          }
          transportSettings = next;
          return json({
            ...transportSettingsResponse(next),
            restartRequired: !options.applyTransportSettings,
          });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'homeassistant' && request.method === 'GET' && parts.length === 2) {
        return json(homeAssistantSettingsResponse(homeAssistantSettings));
      }

      if (parts[1] === 'homeassistant' && request.method === 'PUT' && parts.length === 2) {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const next = parseHomeAssistantSettings(body, homeAssistantSettings);
          await options.applyHomeAssistantSettings?.(next);
          try {
            await options.saveHomeAssistantSettings?.(next);
          } catch (error) {
            await options
              .applyHomeAssistantSettings?.(homeAssistantSettings)
              .catch(() => undefined);
            throw error;
          }
          homeAssistantSettings = next;
          return json({
            ...homeAssistantSettingsResponse(next),
            restartRequired: !options.applyHomeAssistantSettings,
          });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'mqtt' && request.method === 'GET' && parts.length === 2) {
        return json(
          mqttSettingsResponse(
            mqttSettings,
            options.mqttStatus?.(),
            homeAssistantSettings.discoveryTopic,
          ),
        );
      }

      if (parts[1] === 'mqtt' && request.method === 'PUT' && parts.length === 2) {
        let next: MqttSettings;
        try {
          const body = (await request.json()) as Record<string, unknown>;
          next = parseMqttSettings(body, mqttSettings);
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
        try {
          await options.applyMqttSettings?.(next);
          try {
            await options.saveMqttSettings?.(next);
          } catch (error) {
            await options.applyMqttSettings?.(mqttSettings).catch(() => undefined);
            throw error;
          }
          mqttSettings = next;
          return json({
            ...mqttSettingsResponse(
              next,
              options.mqttStatus?.(),
              homeAssistantSettings.discoveryTopic,
            ),
            restartRequired: !options.applyMqttSettings,
          });
        } catch (error) {
          return json({ error: (error as Error).message }, 500);
        }
      }

      if (parts[1] === 'devices' && request.method === 'GET' && parts.length === 2) {
        return json(options.registry?.list() ?? initialDevices.map((device) => ({ ...device })));
      }

      if (parts[1] === 'listen' && request.method === 'GET' && parts.length === 2) {
        return json(options.listener?.snapshot() ?? { active: false, packets: [] });
      }

      if (
        parts[1] === 'listen' &&
        request.method === 'POST' &&
        parts.length === 3 &&
        (parts[2] === 'start' || parts[2] === 'stop')
      ) {
        if (!options.listener) return json({ error: 'Packet listener is unavailable' }, 503);
        if (parts[2] === 'start') options.listener.start();
        else options.listener.stop();
        return json(options.listener.snapshot());
      }

      if (parts[1] === 'devices' && request.method === 'PUT' && parts.length === 3) {
        const targetId = Number(parts[2]);
        const registry = options.registry;
        if (!registry || !Number.isInteger(targetId)) return json({ error: 'Unknown device' }, 404);
        if (!registry.findByTargetId(targetId)) return json({ error: 'Unknown device' }, 404);
        try {
          const rawBody: unknown = await request.json();
          if (!rawBody || typeof rawBody !== 'object' || Array.isArray(rawBody)) {
            throw new Error('Request body must be an object');
          }
          const name = readString(rawBody as Record<string, unknown>, 'name', undefined);
          if (!name) throw new Error('name must not be empty');
          return json(await registry.update(targetId, { name }));
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'pairing' && request.method === 'GET' && parts.length === 2) {
        return json(
          options.teachIn
            ? { active: options.teachIn.isActive(), candidates: options.teachIn.listCandidates() }
            : pairing,
        );
      }

      if (parts[1] === 'pairing' && request.method === 'POST' && parts[2] === 'start') {
        options.teachIn?.start();
        pairing.active = true;
        return json(
          options.teachIn
            ? { active: options.teachIn.isActive(), candidates: options.teachIn.listCandidates() }
            : pairing,
        );
      }

      if (parts[1] === 'pairing' && request.method === 'POST' && parts[2] === 'stop') {
        options.teachIn?.stop();
        pairing.active = false;
        return json(
          options.teachIn
            ? { active: options.teachIn.isActive(), candidates: options.teachIn.listCandidates() }
            : pairing,
        );
      }

      if (parts[1] === 'pairing' && parts[2] === 'accept' && request.method === 'POST') {
        if (!options.teachIn) return json({ error: 'Teach-in is unavailable' }, 503);
        try {
          const body = (await request.json()) as {
            targetId: number;
            roomId: string;
            roomName: string;
            key: string;
            name: string;
          };
          return json(await options.teachIn.accept(Number(body.targetId), body));
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'pairing' && parts[2] === 'reject' && request.method === 'POST') {
        if (!options.teachIn) return json({ error: 'Teach-in is unavailable' }, 503);
        try {
          const body = (await request.json()) as { targetId: number };
          options.teachIn.reject(Number(body.targetId));
          return json({ ok: true });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (
        parts[1] === 'devices' &&
        parts.length === 4 &&
        parts[3] === 'command' &&
        request.method === 'POST'
      ) {
        const targetId = Number(parts[2]);
        const device = options.registry?.findByTargetId(targetId);
        if (!device || !Number.isInteger(targetId)) return json({ error: 'Unknown device' }, 404);
        try {
          await sendCommand(device, await parseCommandBody(request, device));
          return json({ ok: true });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      return json({ error: 'Not found' }, 404);
    }

    if (request.method === 'GET' && parts.length === 0) parts = ['index.html'];

    if (parts.length === 1 && request.method === 'GET' && parts[0] === 'index.html') {
      const filePath = join(webRoot, 'index.html');
      try {
        return new Response(await readFile(filePath), {
          headers: { 'content-type': contentType(filePath) },
        });
      } catch {
        return new Response('Web UI is not installed', { status: 404 });
      }
    }

    if (parts.length !== 3) return new Response(null, { status: 404 });
    if (request.method !== 'GET') return new Response(null, { status: 405 });

    const [room, device, value] = parts;
    console.log('Received request with params:', { room, device, value });

    const deviceConfig = options.registry
      ? options.registry.findByLocation(room, device)
      : findLegacyDevice(room, device);

    if (!deviceConfig) return new Response(null, { status: 400 });

    const { protocol } = deviceConfig;
    if (protocol !== 'D2-50-00') {
      return json({ error: `Unsupported device protocol: ${protocol}` }, 422);
    }

    try {
      await sendCommand(deviceConfig, parseCommandValue(value));
      return new Response(null, { status: 200 });
    } catch {
      return new Response(null, { status: 400 });
    }
  };
}
