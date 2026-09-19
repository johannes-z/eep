import { connect, type MqttClient } from 'mqtt';
import type { Device, HomeAssistantSettings } from '../../config';
import type { DeviceRegistry } from '../../devices/registry';
import type { MqttSettings } from '../../mqtt';
import { MqttFanBridge } from '../homeassistant/bridge';

export interface MqttRuntimeStatus {
  connected: boolean;
  error?: string;
}

function connectionUrl(settings: MqttSettings): string {
  if (!settings.tls || settings.url.startsWith('mqtts://')) return settings.url;
  if (!settings.url.startsWith('mqtt://')) return settings.url;
  return `mqtts://${settings.url.slice('mqtt://'.length)}`;
}

export class MqttRuntime {
  private client: MqttClient | undefined;
  private bridge: MqttFanBridge | undefined;

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly sendCommand: (device: Device, value: number) => Promise<void>,
    private readonly runtimeStatus: MqttRuntimeStatus,
  ) {}

  async apply(settings: MqttSettings, homeAssistant: HomeAssistantSettings): Promise<void> {
    await this.stop();
    this.runtimeStatus.error = undefined;
    if (!settings.url) return;

    const client = connect(connectionUrl(settings), {
      username: settings.username,
      password: settings.password,
      clientId: settings.clientId,
      keepalive: settings.keepalive,
      protocolVersion: settings.version,
      properties: { maximumPacketSize: settings.maximumPacketSize },
      rejectUnauthorized: settings.rejectUnauthorized,
      ca: settings.ca,
      cert: settings.cert,
      key: settings.key,
      will: {
        topic: homeAssistant.statusTopic,
        payload: 'offline',
        qos: 1,
        retain: true,
      },
    });
    this.client = client;
    client.on('connect', () => {
      this.runtimeStatus.connected = true;
      this.runtimeStatus.error = undefined;
      console.log(`MQTT connected to ${connectionUrl(settings)}`);
    });
    client.on('close', () => {
      this.runtimeStatus.connected = false;
    });
    client.on('error', (error) => {
      this.runtimeStatus.connected = false;
      this.runtimeStatus.error = error.message;
      console.error('MQTT connection error:', error.message);
    });
    this.bridge = new MqttFanBridge(client, this.registry, this.sendCommand, {
      ...settings,
      homeAssistant,
    });
    this.bridge.start();
  }

  async stop(): Promise<void> {
    await this.bridge?.stop();
    this.bridge = undefined;
    if (this.client) {
      this.client.end(true);
      this.client = undefined;
    }
    this.runtimeStatus.connected = false;
  }
}
