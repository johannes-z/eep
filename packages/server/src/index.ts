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
  loadMqttSettings,
  loadTransportSettings,
  saveHomeAssistantSettings,
  saveMqttSettings,
  saveTransportSettings,
} from './settings';
import { openTransport } from './transport/adapters';
import { buildUteTeachInResponse } from './transport/esp3';
import { TransportRuntime } from './transport/runtime';
import { PacketListener } from './transport/listener';

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
  controllerId: number,
): (candidate: TeachInCandidate) => Promise<void> {
  return async (candidate): Promise<void> => {
    await getSocket().write(
      buildUteTeachInResponse(controllerId, candidate.targetId, candidate.requestPayload),
    );
  };
}

export async function initialize(addonConfig: AddonConfig = {}): Promise<void> {
  try {
    const initialConfig = resolveServerConfig(addonConfig);
    const dataDir = initialConfig.dataDir;
    const registry = await DeviceRegistry.load(join(dataDir, 'states.json'));
    const settingsPath = join(dataDir, 'settings.json');
    const storedMqttSettings = await loadMqttSettings(settingsPath);
    const storedTransportSettings = await loadTransportSettings(settingsPath);
    const storedHomeAssistantSettings = await loadHomeAssistantSettings(settingsPath);
    const serverConfig = resolveServerConfig({
      ...addonConfig,
      transport: { ...storedTransportSettings, ...addonConfig.transport },
      homeAssistant: { ...storedHomeAssistantSettings, ...addonConfig.homeAssistant },
    });
    let activeMqttSettings = getMqttSettings(
      { ...addonConfig, mqtt: serverConfig.mqtt },
      storedMqttSettings,
    );
    let homeAssistantSettings = serverConfig.homeAssistant;
    const mqttStatus: MqttStatus = { connected: false };

    const configuredControllerId = registry.list()[0]?.sourceId ?? 0;
    const controllerId = serverConfig.controllerId ?? configuredControllerId;
    const handleFatalSocketError = (reason: string): void => {
      console.error(`Fatal socket issue: ${reason}. Exiting to trigger Watchdog.`);
      process.exit(1);
    };
    let transportRuntime: TransportRuntime;
    const packetListener = new PacketListener();
    const teachIn = new TeachInManager(
      registry,
      controllerId,
      createTeachInResponder(() => transportRuntime.current, controllerId),
    );
    transportRuntime = new TransportRuntime(
      await openTransport(serverConfig.transport),
      registry,
      teachIn,
      handleFatalSocketError,
    );
    transportRuntime.onPacket((frame, radioPacket) => packetListener.capture(frame, radioPacket));
    await transportRuntime.start();

    const mqttRuntime = new MqttRuntime(
      registry,
      (device, value) => sendDeviceCommand(transportRuntime.current, registry, device, value),
      mqttStatus,
    );
    const applyMqttSettings = async (settings: MqttSettings): Promise<void> => {
      activeMqttSettings = settings;
      await mqttRuntime.apply(settings, homeAssistantSettings);
    };
    const applyHomeAssistantSettings = async (
      settings: typeof homeAssistantSettings,
    ): Promise<void> => {
      homeAssistantSettings = settings;
      if (activeMqttSettings) await applyMqttSettings(activeMqttSettings);
    };

    const applyTransportSettings = async (
      settings: typeof serverConfig.transport,
    ): Promise<void> => {
      await transportRuntime.replace(settings);
    };

    const server = Bun.serve({
      routes: { '/': homepage as never, '/index.html': homepage as never },
      development: process.env.NODE_ENV !== 'production',
      hostname: serverConfig.host,
      port: serverConfig.port,
      fetch: createRequestHandler(() => transportRuntime.current, {
        registry,
        teachIn,
        webRoot: serverConfig.webRoot,
        transportSettings: serverConfig.transport,
        saveTransportSettings: (settings) => saveTransportSettings(settingsPath, settings),
        applyTransportSettings,
        homeAssistantSettings: serverConfig.homeAssistant,
        saveHomeAssistantSettings: (settings) => saveHomeAssistantSettings(settingsPath, settings),
        applyHomeAssistantSettings,
        mqttSettings: activeMqttSettings ?? defaultMqttSettings(),
        saveMqttSettings: (settings) => saveMqttSettings(settingsPath, settings),
        applyMqttSettings,
        mqttStatus: () => ({ ...mqttStatus }),
        listener: packetListener,
      }),
    });

    if (activeMqttSettings) await applyMqttSettings(activeMqttSettings);

    let shutdownPromise: Promise<void> | undefined;
    const shutdown = async (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        try {
          await mqttRuntime.stop();
          await transportRuntime.stop();
          await server.stop();
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

    console.log(`Server listening on port ${server.port}`);
  } catch (error) {
    console.error('Initialization error:', error);
    throw error;
  }
}
