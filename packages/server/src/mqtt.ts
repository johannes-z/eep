import type { MqttConfig } from './config';

export interface MqttSettings extends MqttConfig {
  url: string;
}

export interface MqttClientLike {
  readonly connected?: boolean;
  on(event: 'connect', listener: () => void): this;
  on(event: 'close', listener: () => void): this;
  on(event: 'message', listener: (topic: string, payload: Buffer) => void): this;
  publish(
    topic: string,
    payload: string,
    options: { qos: 1; retain: boolean },
    callback?: (error?: Error) => void,
  ): void;
  subscribe(topic: string, options: { qos: 1 }, callback?: (error?: Error) => void): void;
}

export function defaultMqttSettings(): MqttSettings {
  return {
    url: '',
    baseTopic: 'eep',
    keepalive: 60,
    maximumPacketSize: 1048576,
    rejectUnauthorized: true,
    includeDeviceInformation: true,
    version: 4,
  };
}
