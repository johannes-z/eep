import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { resolveServerConfig } from '../config';
import type { Device, GeneralSettings, HomeAssistantSettings, TransportSettings } from '../config';
import { sendDeviceCommand, type TransmitListener } from '../devices/commands';
import { initialDevices } from '../devices/registry';
import type { DeviceRegistry } from '../devices/registry';
import type { TeachInManager } from '../devices/teachin';
import { defaultMqttSettings, type MqttSettings } from '../mqtt';
import {
  createDefaultProfileRegistry,
  type ProfileDeviceContext,
  type ProfileRegistry,
} from '../profiles';
import type { TransportConnection } from '../transport/adapters';
import type { PacketListener } from '../transport/listener';
import {
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

export interface RequestTransport extends TransportConnection {}

export type { MqttStatus } from './settings';

export interface RequestHandlerOptions {
  registry?: DeviceRegistry;
  controllerId?: number;
  baseId?: number;
  generalSettings?: GeneralSettings;
  saveGeneralSettings?: (settings: GeneralSettings) => Promise<void>;
  applyGeneralSettings?: (settings: GeneralSettings) => Promise<void>;
  teachIn?: TeachInManager;
  webRoot?: string;
  transportSettings?: TransportSettings;
  transportConnected?: () => boolean;
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
  onTransmit?: TransmitListener;
  profiles?: ProfileRegistry;
}

interface PairingState {
  active: boolean;
  candidates: unknown[];
}

function json(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function profileContext(device: Device): ProfileDeviceContext {
  return {
    sourceId: device.sourceId,
    targetId: device.targetId,
    capabilities: device.capabilities,
    reportedState: device.reportedState,
    desiredState: device.desiredState,
  };
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
  let generalSettings: GeneralSettings = options.generalSettings ?? {
    startId: options.controllerId ?? defaults.startId ?? 1,
  };
  let mqttSettings = { ...(options.mqttSettings ?? defaultMqttSettings()) };
  const getSocket = typeof socket === 'function' ? socket : () => socket;
  const profiles = options.profiles ?? createDefaultProfileRegistry();
  const transportConnected = (settings: TransportSettings): boolean =>
    options.transportConnected?.() ?? settings.type !== 'none';

  function deviceResponse(device: Device): Record<string, unknown> {
    const profile = profiles.get(device.profileId);
    const context = profileContext(device);
    const entity = profile?.entity;
    return {
      ...device,
      ...(profile
        ? {
            profile: {
              id: profile.metadata.id,
              description: profile.metadata.description,
              ...(entity ? { entity: entity.describe(context) } : {}),
            },
          }
        : {}),
      ...(entity ? { entityState: entity.projectState(context) } : {}),
    };
  }

  async function sendCommand(device: Device, request: unknown): Promise<void> {
    await sendDeviceCommand(
      getSocket(),
      options.registry,
      device,
      request,
      profiles,
      undefined,
      options.onTransmit,
    );
  }

  return async function handleRequest(request: Request): Promise<Response> {
    let parts: string[];
    try {
      parts = new URL(request.url).pathname.split('/').filter(Boolean).map(decodeURIComponent);
    } catch {
      return new Response(null, { status: 400 });
    }

    if (parts[0] === 'api') {
      if (parts[1] === 'general' && request.method === 'GET' && parts.length === 2) {
        return json(
          generalSettingsResponse(
            generalSettings,
            options.baseId,
            options.registry?.list() ?? initialDevices,
          ),
        );
      }

      if (parts[1] === 'general' && request.method === 'PUT' && parts.length === 2) {
        try {
          const body = (await request.json()) as Record<string, unknown>;
          const next = parseGeneralSettings(body, generalSettings);
          await options.applyGeneralSettings?.(next);
          try {
            await options.saveGeneralSettings?.(next);
          } catch (error) {
            await options.applyGeneralSettings?.(generalSettings).catch(() => undefined);
            throw error;
          }
          generalSettings = next;
          return json({
            ...generalSettingsResponse(
              next,
              options.baseId,
              options.registry?.list() ?? initialDevices,
            ),
            restartRequired: !options.applyGeneralSettings,
          });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'settings' && request.method === 'GET' && parts.length === 2) {
        return json(
          transportSettingsResponse(transportSettings, transportConnected(transportSettings)),
        );
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
            ...transportSettingsResponse(next, transportConnected(next)),
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
        return json(
          (options.registry?.list() ?? initialDevices.map((device) => ({ ...device }))).map(
            deviceResponse,
          ),
        );
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
        const sourceId = parseRouteId(parts[2]);
        const registry = options.registry;
        if (!registry || !Number.isInteger(sourceId)) return json({ error: 'Unknown device' }, 404);
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
        if (!registry || !Number.isInteger(sourceId)) return json({ error: 'Unknown device' }, 404);
        if (!(await registry.remove(sourceId))) return json({ error: 'Unknown device' }, 404);
        return json({ ok: true });
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

      if (parts[1] === 'pairing' && request.method === 'POST' && parts[2] === 'transmit') {
        if (!options.teachIn) return json({ error: 'Teach-in is unavailable' }, 503);
        try {
          const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
          const rawSourceId = body.sourceId;
          const sourceId = rawSourceId === undefined ? undefined : parseEnOceanId(rawSourceId);
          if (rawSourceId !== undefined && (sourceId === undefined || sourceId < 1)) {
            throw new Error('sourceId must be a non-zero EnOcean identifier');
          }
          if (sourceId !== undefined) options.teachIn.start();
          await options.teachIn.transmit(sourceId);
          pairing.active = true;
          return json({
            active: options.teachIn.isActive(),
            candidates: options.teachIn.listCandidates(),
          });
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'pairing' && parts[2] === 'accept' && request.method === 'POST') {
        if (!options.teachIn) return json({ error: 'Teach-in is unavailable' }, 503);
        try {
          const body = (await request.json()) as {
            targetId: number;
          };
          const targetId = parseEnOceanId(body.targetId);
          if (targetId === undefined) throw new Error('targetId must be an EnOcean identifier');
          return json(await options.teachIn.accept(targetId));
        } catch (error) {
          return json({ error: (error as Error).message }, 400);
        }
      }

      if (parts[1] === 'pairing' && parts[2] === 'reject' && request.method === 'POST') {
        if (!options.teachIn) return json({ error: 'Teach-in is unavailable' }, 503);
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
        const device = options.registry
          ? options.registry.findBySourceId(sourceId)
          : initialDevices.find((item) => item.sourceId === sourceId);
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

    if (request.method === 'GET' && parts.length === 0) parts = ['index.html'];
    if (
      request.method === 'GET' &&
      parts.length > 0 &&
      parts.length < 3 &&
      (parts.length === 1 || parts[0] === 'settings') &&
      !extname(parts.at(-1) ?? '')
    ) {
      parts = ['index.html'];
    }

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

    return new Response(null, { status: 404 });
  };
}
