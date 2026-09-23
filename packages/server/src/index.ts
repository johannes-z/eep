import { join } from 'node:path';
import homepage from '../public/index.html';

import { getMqttSettings, resolveServerConfig, type AddonConfig } from './config';
import { createApplicationLifecycle } from './app/lifecycle';
import { createRequestHandler } from './app/requestHandler';
import type { MqttStatus } from './app/settings';
import { sendDeviceCommand } from './devices/commands';
import { DeviceRegistry } from './devices/registry';
import { TeachInManager, type TeachInCandidate } from './devices/teachin';
import { defaultMqttSettings, type MqttSettings } from './mqtt';
import { MqttRuntime } from './integrations/mqtt/client';
import {
  loadConfiguration,
  saveHomeAssistantSettings,
  saveGeneralSettings,
  saveMqttSettings,
  saveTransportSettings,
} from './settings';
import { closeTransport, openTransport, type TransportConnection } from './transport/adapters';
import {
  build4bsTeachInResponse,
  buildUteTeachInQuery,
  buildUteTeachInResponse,
  readBaseId,
  readVersion,
  type UteResponse,
} from './transport/esp3';
import { TransportRuntime } from './transport/runtime';
import { PacketListener } from './transport/listener';
import { createDefaultProfileRegistry } from './profiles';
import { appRoutes } from './ui/routes';
import { createStateUpdates } from './app/stateUpdates';
import { requireEnOceanId } from './util/enoceanId';

const homepageRoutes = Object.fromEntries([
  ['/', homepage as never],
  ...appRoutes.map(({ path }) => [path, homepage as never]),
]);

function createTeachInResponder(
  getSocket: () => TransportConnection,
  onTransmit: (payload: Uint8Array) => void,
): (candidate: TeachInCandidate, response: UteResponse) => Promise<void> {
  return async (candidate, response): Promise<void> => {
    const buildResponse =
      candidate.protocol === '4bs' ? build4bsTeachInResponse : buildUteTeachInResponse;
    const payload = buildResponse(
      candidate.sourceId,
      candidate.targetId,
      candidate.requestPayload,
      response,
    );
    await getSocket().write(payload);
    onTransmit(payload);
  };
}

function createTeachInSignalSender(
  getSocket: () => TransportConnection,
  onTransmit: (payload: Uint8Array) => void,
): (sourceId: number, targetId?: number) => Promise<void> {
  return async (sourceId, targetId): Promise<void> => {
    const payload = buildUteTeachInQuery(sourceId, targetId);
    await getSocket().write(payload);
    onTransmit(payload);
  };
}

export async function initialize(addonConfig: AddonConfig = {}): Promise<void> {
  const lifecycle = createApplicationLifecycle((restart) => startServer(addonConfig, restart));
  let shutdownPromise: Promise<void> | undefined;
  const shutdown = (): Promise<void> => {
    shutdownPromise ??= lifecycle
      .stop()
      .catch((error: unknown) => {
        console.error('Shutdown error:', error);
      })
      .finally(() => {
        process.exit(0);
      });
    return shutdownPromise;
  };
  const onShutdown = (): void => {
    void shutdown();
  };
  process.once('SIGINT', onShutdown);
  process.once('SIGTERM', onShutdown);

  try {
    await lifecycle.restart();
  } catch (error) {
    process.off('SIGINT', onShutdown);
    process.off('SIGTERM', onShutdown);
    throw error;
  }
}

async function startServer(
  addonConfig: AddonConfig,
  restart: () => Promise<void>,
): Promise<() => Promise<void>> {
  let registry: DeviceRegistry | undefined;
  let initialTransport: TransportConnection | undefined;
  let transportRuntime: TransportRuntime | undefined;
  let mqttRuntime: MqttRuntime | undefined;
  let packetListener: PacketListener | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  let stateUpdates: ReturnType<typeof createStateUpdates> | undefined;
  const subscriptions: Array<() => void> = [];
  const cleanup = async (): Promise<void> => {
    for (const unsubscribe of subscriptions) unsubscribe();
    stateUpdates?.dispose();
    try {
      await server?.stop(true);
    } catch (error) {
      console.error('HTTP shutdown error:', error);
    }
    try {
      await mqttRuntime?.stop();
    } catch (error) {
      console.error('MQTT shutdown error:', error);
    }
    try {
      if (transportRuntime) await transportRuntime.stop();
      else if (initialTransport) await closeTransport(initialTransport);
    } catch (error) {
      console.error('Transport shutdown error:', error);
    }
    try {
      await registry?.close();
    } catch (error) {
      console.error('Registry shutdown error:', error);
    }
    packetListener?.close();
  };

  try {
    const initialConfig = resolveServerConfig(addonConfig);
    const dataDir = initialConfig.dataDir;
    const profiles = createDefaultProfileRegistry();
    const configurationPath = join(dataDir, 'configuration.yaml');
    const loadedRegistry = await DeviceRegistry.load(configurationPath, profiles);
    registry = loadedRegistry;
    const stored = await loadConfiguration(configurationPath);
    const serverConfig = resolveServerConfig({
      ...addonConfig,
      startId:
        stored.general?.startId === undefined
          ? addonConfig.startId
          : requireEnOceanId(stored.general.startId, 'startId', 1),
      transport: { ...stored.transport, ...addonConfig.transport },
      homeAssistant: { ...stored.homeassistant, ...addonConfig.homeAssistant },
    });
    let activeMqttSettings = getMqttSettings(
      { ...addonConfig, mqtt: serverConfig.mqtt },
      stored.mqtt,
    );
    let homeAssistantSettings = serverConfig.homeAssistant;
    const mqttStatus: MqttStatus = { connected: false };

    const handleTransportError = (reason: string): void => {
      console.error(`[transport] ${reason}. Retrying in the background.`);
    };
    const openedTransport = await openTransport(serverConfig.transport).catch((error: unknown) => {
      handleTransportError(String(error));
      return openTransport({ ...serverConfig.transport, type: 'none' });
    });
    initialTransport = openedTransport;
    let baseId = await readBaseId(openedTransport).catch((error: unknown) => {
      console.warn(`Unable to read USB 300 base ID: ${(error as Error).message}`);
      return undefined;
    });
    let transportHardware = await readVersion(openedTransport).catch((error: unknown) => {
      console.warn('[transport] Unable to read dongle version:', error);
      return undefined;
    });
    const defaultSourceId = baseId !== undefined && baseId < 0xffffffff ? baseId + 1 : 1;
    const startId = serverConfig.startId ?? defaultSourceId;
    let activeTransportRuntime: TransportRuntime;
    const activePacketListener = new PacketListener(join(dataDir, 'state.db'));
    packetListener = activePacketListener;
    const captureTransmit = (payload: Uint8Array): void =>
      activePacketListener.captureOutgoing(payload);
    const teachIn = new TeachInManager(
      loadedRegistry,
      startId,
      createTeachInResponder(() => activeTransportRuntime.current, captureTransmit),
      profiles,
      createTeachInSignalSender(() => activeTransportRuntime.current, captureTransmit),
    );
    activeTransportRuntime = new TransportRuntime(
      openedTransport,
      loadedRegistry,
      teachIn,
      handleTransportError,
      profiles,
    );
    transportRuntime = activeTransportRuntime;
    initialTransport = undefined;
    activeTransportRuntime.onPacket((frame, radioPacket, direction) =>
      activePacketListener.capture(frame, radioPacket, direction),
    );
    await activeTransportRuntime.start(serverConfig.transport);

    const activeMqttRuntime = new MqttRuntime(
      loadedRegistry,
      (device, value) =>
        sendDeviceCommand(
          () => activeTransportRuntime.current,
          loadedRegistry,
          device,
          value,
          profiles,
          captureTransmit,
        ),
      mqttStatus,
      profiles,
      restart,
    );
    mqttRuntime = activeMqttRuntime;
    const applyMqttSettings = async (settings: MqttSettings): Promise<void> => {
      activeMqttSettings = settings;
      await activeMqttRuntime.apply(settings, homeAssistantSettings);
    };
    const applyHomeAssistantSettings = async (
      settings: typeof homeAssistantSettings,
    ): Promise<void> => {
      homeAssistantSettings = settings;
      if (activeMqttSettings) await applyMqttSettings(activeMqttSettings);
    };
    let generalSettings = { startId };
    const applyGeneralSettings = async (settings: typeof generalSettings): Promise<void> => {
      teachIn.setStartId(settings.startId);
      generalSettings = settings;
    };

    const applyTransportSettings = async (
      settings: typeof serverConfig.transport,
    ): Promise<void> => {
      await activeTransportRuntime.replace(settings);
    };

    const handleRequest = createRequestHandler(() => activeTransportRuntime.current, {
      registry: loadedRegistry,
      baseId: () => baseId,
      generalSettings,
      teachIn,
      transportSettings: serverConfig.transport,
      transportConnected: () => activeTransportRuntime.isConnected,
      transportHardware: () => transportHardware,
      saveTransportSettings: (settings) => saveTransportSettings(configurationPath, settings),
      applyTransportSettings,
      saveGeneralSettings: (settings) => saveGeneralSettings(configurationPath, settings),
      applyGeneralSettings,
      homeAssistantSettings,
      saveHomeAssistantSettings: (settings) =>
        saveHomeAssistantSettings(configurationPath, settings),
      applyHomeAssistantSettings,
      mqttSettings: activeMqttSettings ?? defaultMqttSettings(),
      saveMqttSettings: (settings) => saveMqttSettings(configurationPath, settings),
      applyMqttSettings,
      mqttStatus: () => ({ ...mqttStatus }),
      listener: activePacketListener,
      onTransmit: captureTransmit,
      profiles,
      onChange: () => stateUpdates?.notify(),
    });
    const updates = createStateUpdates(handleRequest.snapshot);
    stateUpdates = updates;
    subscriptions.push(
      loadedRegistry.onChange(updates.notify),
      loadedRegistry.onRemove(updates.notify),
      teachIn.onChange(updates.notify),
      activePacketListener.onChange(updates.notify),
      activeMqttRuntime.onStatusChange(updates.notify),
      activeTransportRuntime.onStatusChange(() => {
        baseId = undefined;
        transportHardware = undefined;
        updates.notify();
        if (!activeTransportRuntime.isConnected) return;
        const connection = activeTransportRuntime.current;
        void readBaseId(connection)
          .catch((error: unknown) => {
            console.warn('[transport] Unable to refresh base ID:', error);
            return undefined;
          })
          .then(async (value) => {
            if (
              !activeTransportRuntime.isConnected ||
              activeTransportRuntime.current !== connection
            )
              return;
            baseId = value;
            updates.notify();
            const hardware = await readVersion(connection);
            if (
              !activeTransportRuntime.isConnected ||
              activeTransportRuntime.current !== connection
            )
              return;
            transportHardware = hardware;
            updates.notify();
          })
          .catch((error: unknown) =>
            console.warn('[transport] Unable to refresh dongle version:', error),
          );
      }),
      () => teachIn.stop(),
    );
    const runningServer = Bun.serve<undefined>({
      routes: homepageRoutes,
      development: process.env.NODE_ENV !== 'production',
      hostname: serverConfig.host,
      port: serverConfig.port,
      fetch(request, server) {
        const url = new URL(request.url);
        if (url.pathname === '/api/events') {
          const origin = request.headers.get('origin');
          if (origin && origin !== url.origin) return new Response(null, { status: 403 });
          if (server.upgrade(request)) return;
          return new Response('WebSocket upgrade required', { status: 426 });
        }
        return handleRequest(request);
      },
      websocket: updates.websocket,
    });
    server = runningServer;

    if (activeMqttSettings) await applyMqttSettings(activeMqttSettings);

    console.log(`Server listening on port ${runningServer.port}`);
    return cleanup;
  } catch (error) {
    await cleanup();
    console.error('Initialization error:', error);
    throw error;
  }
}
