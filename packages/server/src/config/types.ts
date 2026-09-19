import type { D2FanState } from '../api/D2-50-00/fan';

export interface Device {
  key: string;
  sourceId: number;
  targetId: number;
  protocol: string;
  roomId: string;
  roomName: string;
  name: string;
  paired: boolean;
  supportedFunctions: string[];
  lastSeen?: string;
  availability: 'online' | 'offline' | 'unknown';
  reportedState?: D2FanState;
  desiredState?: D2FanState;
}

export interface AddonConfig {
  adapter?: string;
  host?: string;
  port?: number;
  dataDir?: string;
  controllerId?: number;
  transport?: Partial<TransportSettings>;
  homeAssistant?: Partial<HomeAssistantSettings>;
  mqtt?: MqttConfig;
}

export type TransportType = 'none' | 'serial' | 'tcp';

export interface TransportSettings {
  type: TransportType;
  adapter: string;
  path: string;
  baudRate: number;
  disableLed: boolean;
  rtscts: boolean;
}

export interface HomeAssistantSettings {
  enabled: boolean;
  discoveryTopic: string;
  statusTopic: string;
  experimentalEventEntities: boolean;
  legacyActionSensor: boolean;
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  webRoot?: string;
  controllerId?: number;
  transport: TransportSettings;
  homeAssistant: HomeAssistantSettings;
  mqtt?: MqttConfig;
}

export interface MqttConfig {
  url?: string;
  username?: string;
  password?: string;
  tls?: boolean;
  discoveryPrefix?: string;
  baseTopic?: string;
  clientId?: string;
  keepalive?: number;
  ca?: string;
  cert?: string;
  key?: string;
  rejectUnauthorized?: boolean;
  forceDisableRetain?: boolean;
  includeDeviceInformation?: boolean;
  maximumPacketSize?: number;
  version?: 3 | 4 | 5;
}
