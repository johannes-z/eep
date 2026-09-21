import { connect, type MqttClient } from 'mqtt';
import { readFile } from 'node:fs/promises';
import type { HomeAssistantSettings } from '../../config';
import type { Device } from '../../devices/types';
import type { DeviceRegistry } from '../../devices/registry';
import type { MqttSettings } from '../../mqtt';
import { MqttEntityBridge } from '../homeassistant/bridge';
import { createDefaultProfileRegistry, type ProfileRegistry } from '../../profiles';

export interface MqttRuntimeStatus {
  connected: boolean;
  error?: string;
}

type MqttClientFactory = typeof connect;

function connectionUrl(settings: MqttSettings): string {
  if (!settings.tls || settings.url.startsWith('mqtts://')) return settings.url;
  if (!settings.url.startsWith('mqtt://')) return settings.url;
  return `mqtts://${settings.url.slice('mqtt://'.length)}`;
}

async function readTlsMaterial(value: string | undefined): Promise<string | undefined> {
  if (!value || value.includes('-----BEGIN ')) return value;
  return readFile(value, 'utf8');
}

export class MqttRuntime {
  private client: MqttClient | undefined;
  private bridge: MqttEntityBridge | undefined;
  private generation = 0;
  private replacementQueue: Promise<void> = Promise.resolve();
  private readonly statusListeners = new Set<() => void>();

  onStatusChange(listener: () => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  private notifyStatus(): void {
    for (const listener of this.statusListeners) listener();
  }

  constructor(
    private readonly registry: DeviceRegistry,
    private readonly sendCommand: (device: Device, request: unknown) => Promise<void>,
    private readonly runtimeStatus: MqttRuntimeStatus,
    private readonly profiles: ProfileRegistry = createDefaultProfileRegistry(),
    private readonly restart?: () => Promise<void>,
    private readonly connectClient: MqttClientFactory = connect,
  ) {}

  async apply(settings: MqttSettings, homeAssistant: HomeAssistantSettings): Promise<void> {
    const operation = this.replacementQueue.then(async () => {
      const [ca, cert, key] = settings.url
        ? await Promise.all([settings.ca, settings.cert, settings.key].map(readTlsMaterial))
        : [];
      await this.stopCurrent();
      this.runtimeStatus.error = undefined;
      this.notifyStatus();
      if (!settings.url) return;

      const generation = this.generation;
      const client = this.connectClient(connectionUrl(settings), {
        username: settings.username,
        password: settings.password,
        clientId: settings.clientId,
        keepalive: settings.keepalive,
        protocolVersion: settings.version,
        properties: { maximumPacketSize: settings.maximumPacketSize },
        rejectUnauthorized: settings.rejectUnauthorized,
        ca,
        cert,
        key,
        will: {
          topic: homeAssistant.statusTopic,
          payload: 'offline',
          qos: 1,
          retain: true,
        },
      });
      this.client = client;
      const isCurrent = (): boolean => this.client === client && this.generation === generation;
      client.on('connect', () => {
        if (!isCurrent()) return;
        this.runtimeStatus.connected = true;
        this.runtimeStatus.error = undefined;
        this.notifyStatus();
        console.log(`MQTT connected to ${new URL(connectionUrl(settings)).host}`);
      });
      client.on('close', () => {
        if (!isCurrent()) return;
        this.runtimeStatus.connected = false;
        this.notifyStatus();
      });
      client.on('error', (error) => {
        if (!isCurrent()) return;
        this.runtimeStatus.connected = false;
        this.runtimeStatus.error = error.message;
        this.notifyStatus();
        console.error('MQTT connection error:', error.message);
      });
      this.bridge = new MqttEntityBridge(
        client,
        this.registry,
        this.sendCommand,
        {
          ...settings,
          homeAssistant,
        },
        this.profiles,
        this.restart,
      );
      this.bridge.start();
    });
    this.replacementQueue = operation.catch(() => undefined);
    return operation;
  }

  async stop(): Promise<void> {
    const operation = this.replacementQueue.then(() => this.stopCurrent());
    this.replacementQueue = operation.catch(() => undefined);
    return operation;
  }

  private async stopCurrent(): Promise<void> {
    this.generation += 1;
    const bridge = this.bridge;
    const client = this.client;
    this.bridge = undefined;
    this.client = undefined;
    await bridge?.stop({ publishOffline: client?.connected !== false });
    if (client) {
      try {
        await new Promise<void>((resolve, reject) => {
          client.end(true, (error) => (error ? reject(error) : resolve()));
        });
      } catch (error) {
        console.error('MQTT shutdown error:', (error as Error).message);
      }
    }
    this.runtimeStatus.connected = false;
    this.notifyStatus();
  }
}
