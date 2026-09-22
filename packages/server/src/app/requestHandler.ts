import { resolveServerConfig } from '../config';
import type { GeneralSettings, HomeAssistantSettings, TransportSettings } from '../config';
import type { Device } from '../devices/types';
import { sendDeviceCommand, type TransmitListener } from '../devices/commands';
import type { DeviceRegistry } from '../devices/registry';
import type { TeachInManager } from '../devices/teachin';
import { defaultMqttSettings, type MqttSettings } from '../mqtt';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../profiles';
import type { TransportConnection } from '../transport/adapters';
import type { DongleVersion } from '../transport/esp3';
import type { PacketListener } from '../transport/listener';
import {
  createSettingsResource,
  generalSettingsResponse,
  homeAssistantSettingsResponse,
  mqttSettingsResponse,
  parseGeneralSettings,
  parseHomeAssistantSettings,
  parseMqttSettings,
  parseRouteId,
  parseTransportSettings,
  transportSettingsResponse,
  type MqttStatus,
} from './settings';
import { parseEnOceanId } from '../util';

export interface RequestHandlerOptions {
  registry: DeviceRegistry;
  baseId?: () => number | undefined;
  generalSettings?: GeneralSettings;
  saveGeneralSettings?: (settings: GeneralSettings) => Promise<void>;
  applyGeneralSettings?: (settings: GeneralSettings) => Promise<void>;
  teachIn: TeachInManager;
  transportSettings?: TransportSettings;
  transportConnected?: () => boolean;
  transportHardware?: () => DongleVersion | undefined;
  saveTransportSettings?: (settings: TransportSettings) => Promise<void>;
  applyTransportSettings?: (settings: TransportSettings) => Promise<void>;
  homeAssistantSettings?: HomeAssistantSettings;
  saveHomeAssistantSettings?: (settings: HomeAssistantSettings) => Promise<void>;
  applyHomeAssistantSettings?: (settings: HomeAssistantSettings) => Promise<void>;
  mqttSettings?: MqttSettings;
  saveMqttSettings?: (settings: MqttSettings) => Promise<void>;
  applyMqttSettings?: (settings: MqttSettings) => Promise<void>;
  mqttStatus?: () => MqttStatus;
  listener: PacketListener;
  onTransmit?: TransmitListener;
  profiles?: ProfileRegistry;
  onChange?: () => void;
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function createRequestHandler(
  getSocket: () => TransportConnection,
  options: RequestHandlerOptions,
) {
  const defaults = resolveServerConfig();
  const profiles = options.profiles ?? createDefaultProfileRegistry();
  const transportConnected = (settings: TransportSettings): boolean =>
    options.transportConnected?.() ?? settings.type !== 'none';

  const devices = () => options.registry.list();
  const pairing = () => ({
    active: options.teachIn.isActive(),
    candidates: options.teachIn.listCandidates(),
    ignoredDevices: options.teachIn.listIgnoredDevices(),
  });
  const general = createSettingsResource({
    initial: options.generalSettings ?? { startId: defaults.startId ?? 1 },
    parse: parseGeneralSettings,
    describe: (settings) => generalSettingsResponse(settings, options.baseId?.(), devices()),
    apply: options.applyGeneralSettings,
    save: options.saveGeneralSettings,
  });
  const transport = createSettingsResource({
    initial: options.transportSettings ?? defaults.transport,
    parse: parseTransportSettings,
    describe: (settings) =>
      transportSettingsResponse(
        settings,
        transportConnected(settings),
        options.transportHardware?.(),
      ),
    apply: options.applyTransportSettings,
    save: options.saveTransportSettings,
  });
  const homeAssistant = createSettingsResource({
    initial: options.homeAssistantSettings ?? defaults.homeAssistant,
    parse: parseHomeAssistantSettings,
    describe: homeAssistantSettingsResponse,
    apply: options.applyHomeAssistantSettings,
    save: options.saveHomeAssistantSettings,
  });
  const mqtt = createSettingsResource({
    initial: options.mqttSettings ?? defaultMqttSettings(),
    parse: parseMqttSettings,
    describe: (settings) => mqttSettingsResponse(settings, options.mqttStatus?.()),
    apply: options.applyMqttSettings,
    save: options.saveMqttSettings,
    failureStatus: 500,
  });
  const settingsRoutes: Record<string, Pick<typeof general, 'read' | 'update'>> = {
    general,
    settings: transport,
    homeassistant: homeAssistant,
    mqtt,
  };

  function deviceResponse(device: Device): Record<string, unknown> {
    const profile = profiles.get(device.profileId);
    const entity = profile?.entity;
    return {
      ...device,
      ...(profile
        ? {
            profile: {
              id: profile.metadata.id,
              description: profile.metadata.description,
              ...(entity ? { entity: entity.describe(device) } : {}),
            },
          }
        : {}),
      ...(entity ? { entityState: entity.projectState(device) } : {}),
    };
  }

  async function sendCommand(device: Device, request: unknown): Promise<void> {
    await sendDeviceCommand(
      getSocket(),
      options.registry,
      device,
      request,
      profiles,
      options.onTransmit,
    );
  }

  function snapshot() {
    return {
      devices: devices().map(deviceResponse),
      general: general.read(),
      transport: transport.read(),
      homeAssistant: homeAssistant.read(),
      mqtt: mqtt.read(),
      pairing: pairing(),
      listen: options.listener.snapshot(),
    };
  }

  async function handleRequest(request: Request): Promise<Response> {
    const origin = request.headers.get('origin');
    if (
      request.method !== 'GET' &&
      request.method !== 'HEAD' &&
      origin &&
      origin !== new URL(request.url).origin
    ) {
      return json({ error: 'Cross-origin requests are not allowed' }, 403);
    }
    let parts: string[];
    try {
      parts = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return new Response(null, { status: 400 });
    }

    if (parts[0] === 'api') {
      const resource = Object.hasOwn(settingsRoutes, parts[1])
        ? settingsRoutes[parts[1]]
        : undefined;
      if (resource && parts.length === 2) {
        if (request.method === 'GET') return json(resource.read());
        if (request.method === 'PUT') return resource.update(request);
      }

      if (parts[1] === 'devices' && request.method === 'GET' && parts.length === 2) {
        return json(devices().map(deviceResponse));
      }

      if (parts[1] === 'listen' && request.method === 'GET' && parts.length === 2) {
        return json(options.listener.snapshot());
      }

      if (
        parts[1] === 'listen' &&
        request.method === 'POST' &&
        parts.length === 3 &&
        (parts[2] === 'start' || parts[2] === 'stop')
      ) {
        if (parts[2] === 'start') options.listener.start();
        else options.listener.stop();
        return json(options.listener.snapshot());
      }

      if (parts[1] === 'devices' && request.method === 'PUT' && parts.length === 3) {
        const sourceId = parseRouteId(parts[2]);
        const registry = options.registry;
        if (!Number.isInteger(sourceId)) return json({ error: 'Unknown device' }, 404);
        try {
          const body = (await request.json()) as Record<string, unknown>;
          if (typeof body.name !== 'string' || !body.name.trim()) {
            throw new Error('name must be a non-empty string');
          }
          return json(await registry.update(sourceId, { name: body.name.trim() }));
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'devices' && request.method === 'DELETE' && parts.length === 3) {
        const sourceId = parseRouteId(parts[2]);
        const registry = options.registry;
        if (!Number.isInteger(sourceId)) return json({ error: 'Unknown device' }, 404);
        if (!(await registry.remove(sourceId))) return json({ error: 'Unknown device' }, 404);
        return json({ ok: true });
      }

      if (parts[1] === 'pairing' && request.method === 'GET' && parts.length === 2) {
        return json(pairing());
      }

      if (parts[1] === 'pairing' && request.method === 'POST' && parts[2] === 'start') {
        options.teachIn.start();
        return json(pairing());
      }

      if (parts[1] === 'pairing' && request.method === 'POST' && parts[2] === 'stop') {
        options.teachIn.stop();
        return json(pairing());
      }

      if (parts[1] === 'pairing' && request.method === 'POST' && parts[2] === 'transmit') {
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const rawSourceId = body.sourceId;
          const sourceId = rawSourceId === undefined ? undefined : parseEnOceanId(rawSourceId);
          if (rawSourceId !== undefined && (sourceId === undefined || sourceId < 1)) {
            throw new Error('sourceId must be a non-zero EnOcean identifier');
          }
          if (sourceId !== undefined) options.teachIn.start();
          await options.teachIn.transmit(sourceId);
          return json(pairing());
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'pairing' && parts[2] === 'accept' && request.method === 'POST') {
        try {
          const body = (await request.json()) as {
            targetId: number;
            profileId?: string;
          };
          if (body.profileId !== undefined && typeof body.profileId !== 'string') {
            throw new Error('profileId must be an EEP string');
          }
          const targetId = parseEnOceanId(body.targetId);
          if (targetId === undefined) throw new Error('targetId must be an EnOcean identifier');
          return json(await options.teachIn.accept(targetId, body.profileId));
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (
        parts[1] === 'pairing' &&
        parts.length === 3 &&
        (parts[2] === 'ignore' || parts[2] === 'unignore') &&
        request.method === 'POST'
      ) {
        try {
          const body = (await request.json()) as { targetId: number };
          const targetId = parseEnOceanId(body.targetId);
          if (targetId === undefined) throw new Error('targetId must be an EnOcean identifier');
          if (parts[2] === 'ignore') await options.teachIn.ignore(targetId);
          else await options.teachIn.clearIgnored(targetId);
          return json(pairing());
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'pairing' && parts[2] === 'reject' && request.method === 'POST') {
        try {
          const body = (await request.json()) as { targetId: number };
          const targetId = parseEnOceanId(body.targetId);
          if (targetId === undefined) throw new Error('targetId must be an EnOcean identifier');
          options.teachIn.reject(targetId);
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
        const sourceId = parseRouteId(parts[2]);
        const device = options.registry.findBySourceId(sourceId);
        if (!device || !Number.isInteger(sourceId)) return json({ error: 'Unknown device' }, 404);
        try {
          await sendCommand(device, await request.json());
          return json({ ok: true });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      return json({ error: 'Not found' }, 404);
    }

    return new Response(null, { status: 404 });
  }

  return Object.assign(
    async (request: Request): Promise<Response> => {
      try {
        return await handleRequest(request);
      } finally {
        if (request.method !== 'GET' && request.method !== 'HEAD') options.onChange?.();
      }
    },
    { snapshot },
  );
}
