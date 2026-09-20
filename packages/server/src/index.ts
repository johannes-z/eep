import { join } from 'node:path';
import homepage from '../public/index.html';

import {
  resolveServerConfig,
  validateMqttConfig,
  type AddonConfig,
  type TransportSettings,
} from './config';
import { createRequestHandler, type MqttStatus, type RequestTransport } from './app/requestHandler';
import { sendDeviceCommand } from './devices/commands';
import { DeviceRegistry } from './devices/registry';
import { TeachInManager, type TeachInCandidate } from './devices/teachin';
import { defaultMqttSettings, type MqttSettings } from './mqtt';
import { MqttRuntime } from './integrations/mqtt/client';
import {
  loadHomeAssistantSettings,
  loadGeneralSettings,
  loadMqttSettings,
  loadTransportSettings,
  saveHomeAssistantSettings,
  saveGeneralSettings,
  saveMqttSettings,
  saveTransportSettings,
} from './settings';
import { closeTransport, openTransport } from './transport/adapters';
import {
  buildUteTeachInQuery,
  buildUteTeachInResponse,
  readBaseId,
  type UteResponse,
} from './transport/esp3';
import { TransportRuntime } from './transport/runtime';
import { PacketListener } from './transport/listener';
import { createDefaultProfileRegistry } from './profiles';
import { appRoutes } from './ui/routes';

const homepageRoutes = Object.fromEntries([
  ['/index.html', homepage as never],
  ...appRoutes.map(({ path }) => [path, homepage as never]),
]);

export { createRequestHandler, sendDeviceCommand };
export type { RequestTransport };

export async function getSocketConnection(path: string): Promise<RequestTransport> {
  const settings: TransportSettings = {
    type: path.startsWith('tcp://') ? 'tcp' : 'serial',
    adapter: '',
    path,
    baudRate: 57600,
    disableLed: false,
    rtscts: false,
  };
  return openTransport(settings);
}

export function getMqttSettings(
  addonConfig: AddonConfig,
  stored: Partial<MqttSettings> = {},
): MqttSettings | undefined {
  const configured = addonConfig.mqtt ?? {};
  const url =
    stored.url ??
    configured.url ??
    process.env.MQTT_URL ??
    (process.env.MQTT_HOST
      ? `${process.env.MQTT_TLS === 'true' ? 'mqtts' : 'mqtt'}://${process.env.MQTT_HOST}:${process.env.MQTT_PORT ?? '1883'}`
      : undefined);
  if (!url) return undefined;
  const versionValue = Number(process.env.MQTT_VERSION ?? 4);
  const version: 3 | 4 | 5 =
    versionValue === 3 || versionValue === 4 || versionValue === 5 ? versionValue : 4;
  const settings: MqttSettings = {
    url,
    username:
      stored.username ?? configured.username ?? process.env.MQTT_USERNAME ?? process.env.MQTT_USER,
    password: stored.password ?? configured.password ?? process.env.MQTT_PASSWORD,
    tls: stored.tls ?? configured.tls ?? process.env.MQTT_TLS === 'true',
    discoveryPrefix:
      stored.discoveryPrefix ??
      configured.discoveryPrefix ??
      process.env.MQTT_DISCOVERY_PREFIX ??
      'homeassistant',
    baseTopic: stored.baseTopic ?? configured.baseTopic ?? process.env.MQTT_BASE_TOPIC ?? 'eep',
    clientId: stored.clientId ?? configured.clientId ?? process.env.MQTT_CLIENT_ID,
    keepalive: stored.keepalive ?? configured.keepalive ?? Number(process.env.MQTT_KEEPALIVE ?? 60),
    ca: stored.ca ?? configured.ca ?? process.env.MQTT_CA,
    cert: stored.cert ?? configured.cert ?? process.env.MQTT_CERT,
    key: stored.key ?? configured.key ?? process.env.MQTT_KEY,
    rejectUnauthorized:
      stored.rejectUnauthorized ??
      configured.rejectUnauthorized ??
      process.env.MQTT_REJECT_UNAUTHORIZED !== 'false',
    forceDisableRetain:
      stored.forceDisableRetain ??
      configured.forceDisableRetain ??
      process.env.MQTT_FORCE_DISABLE_RETAIN === 'true',
    includeDeviceInformation:
      stored.includeDeviceInformation ??
      configured.includeDeviceInformation ??
      process.env.MQTT_INCLUDE_DEVICE_INFORMATION !== 'false',
    maximumPacketSize:
      stored.maximumPacketSize ??
      configured.maximumPacketSize ??
      Number(process.env.MQTT_MAXIMUM_PACKET_SIZE ?? 1048576),
    version: stored.version ?? configured.version ?? version,
  };
  validateMqttConfig(settings);
  return settings;
}

function createTeachInResponder(
  getSocket: () => RequestTransport,
): (candidate: TeachInCandidate, response: UteResponse) => Promise<void> {
  return async (candidate, response): Promise<void> => {
    await getSocket().write(
      buildUteTeachInResponse(
        candidate.sourceId,
        candidate.targetId,
        candidate.requestPayload,
        response,
      ),
    );
  };
}

function createTeachInSignalSender(
  getSocket: () => RequestTransport,
): (sourceId: number, targetId?: number) => Promise<void> {
  return async (sourceId, targetId): Promise<void> => {
    await getSocket().write(buildUteTeachInQuery(sourceId, targetId));
  };
}

export async function initialize(addonConfig: AddonConfig = {}): Promise<void> {
  let registry: DeviceRegistry | undefined;
  let initialTransport: RequestTransport | undefined;
  let transportRuntime: TransportRuntime | undefined;
  let mqttRuntime: MqttRuntime | undefined;
  let server: ReturnType<typeof Bun.serve> | undefined;
  const cleanup = async (): Promise<void> => {
    try {
      await server?.stop();
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
  };

  try {
    const initialConfig = resolveServerConfig(addonConfig);
    const dataDir = initialConfig.dataDir;
    const profiles = createDefaultProfileRegistry();
    const configurationPath = join(dataDir, 'configuration.yaml');
    const loadedRegistry = await DeviceRegistry.load(configurationPath, profiles);
    registry = loadedRegistry;
    const storedMqttSettings = await loadMqttSettings(configurationPath);
    const storedTransportSettings = await loadTransportSettings(configurationPath);
    const storedHomeAssistantSettings = await loadHomeAssistantSettings(configurationPath);
    const storedGeneralSettings = await loadGeneralSettings(configurationPath);
    const serverConfig = resolveServerConfig({
      ...addonConfig,
      startId: storedGeneralSettings?.startId ?? addonConfig.startId,
      transport: { ...storedTransportSettings, ...addonConfig.transport },
      homeAssistant: { ...storedHomeAssistantSettings, ...addonConfig.homeAssistant },
    });
    let activeMqttSettings = getMqttSettings(
      { ...addonConfig, mqtt: serverConfig.mqtt },
      storedMqttSettings,
    );
    let homeAssistantSettings = serverConfig.homeAssistant;
    const mqttStatus: MqttStatus = { connected: false };

    const handleFatalSocketError = (reason: string): void => {
      console.error(`Fatal socket issue: ${reason}. Exiting to trigger Watchdog.`);
      process.exit(1);
    };
    const openedTransport = await openTransport(serverConfig.transport);
    initialTransport = openedTransport;
    const baseId = await readBaseId(openedTransport).catch((error: unknown) => {
      console.warn(`Unable to read USB 300 base ID: ${(error as Error).message}`);
      return undefined;
    });
    const defaultSourceId = baseId !== undefined && baseId < 0xffffffff ? baseId + 1 : 1;
    const configuredControllerId = loadedRegistry.list()[0]?.sourceId;
    const startId =
      serverConfig.startId ??
      serverConfig.controllerId ??
      configuredControllerId ??
      defaultSourceId;
    if (!Number.isInteger(startId) || startId < 1 || startId > 0xffffffff) {
      throw new Error(
        'A non-zero START_ID, CONTROLLER_ID, or persisted device sourceId is required for UTE teach-in',
      );
    }
    const controllerId = serverConfig.controllerId ?? configuredControllerId ?? defaultSourceId;
    let activeTransportRuntime: TransportRuntime;
    const packetListener = new PacketListener();
    const teachIn = new TeachInManager(
      loadedRegistry,
      controllerId,
      createTeachInResponder(() => activeTransportRuntime.current),
      profiles,
      createTeachInSignalSender(() => activeTransportRuntime.current),
      startId,
    );
    activeTransportRuntime = new TransportRuntime(
      openedTransport,
      loadedRegistry,
      teachIn,
      handleFatalSocketError,
      profiles,
    );
    transportRuntime = activeTransportRuntime;
    initialTransport = undefined;
    activeTransportRuntime.onPacket((frame, radioPacket) =>
      packetListener.capture(frame, radioPacket),
    );
    await activeTransportRuntime.start();

    const activeMqttRuntime = new MqttRuntime(
      loadedRegistry,
      (device, value) =>
        sendDeviceCommand(activeTransportRuntime.current, loadedRegistry, device, value, profiles),
      mqttStatus,
      profiles,
      teachIn,
      async () => {
        process.kill(process.pid, 'SIGTERM');
      },
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

    const runningServer = Bun.serve({
      routes: homepageRoutes,
      development: process.env.NODE_ENV !== 'production',
      hostname: serverConfig.host,
      port: serverConfig.port,
      fetch: createRequestHandler(() => activeTransportRuntime.current, {
        registry: loadedRegistry,
        controllerId,
        baseId,
        generalSettings,
        teachIn,
        webRoot: serverConfig.webRoot,
        transportSettings: serverConfig.transport,
        transportConnected: () => activeTransportRuntime.isConnected,
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
        listener: packetListener,
        profiles,
      }),
    });
    server = runningServer;

    if (activeMqttSettings) await applyMqttSettings(activeMqttSettings);

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = async (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        try {
          await cleanup();
        } catch (error) {
          console.error('Shutdown error:', error);
        } finally {
          process.exit(0);
        }
      })();
      return shutdownPromise;
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());

    console.log(`Server listening on port ${runningServer.port}`);
  } catch (error) {
    await cleanup();
    console.error('Initialization error:', error);
    throw error;
  }
}
