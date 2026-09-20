export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface GeneralSettings {
  startId: number;
}

export interface AddonConfig {
  host?: string;
  port?: number;
  dataDir?: string;
  startId?: number;
  transport?: Partial<TransportSettings>;
  homeAssistant?: Partial<HomeAssistantSettings>;
  mqtt?: MqttConfig;
}

export type TransportType = 'none' | 'serial' | 'tcp';

export interface TransportSettings {
  type: TransportType;
  path: string;
  baudRate: number;
  rtscts: boolean;
}

export interface HomeAssistantSettings {
  enabled: boolean;
  discoveryTopic: string;
  statusTopic: string;
  logLevel?: LogLevel;
}

export interface ServerConfig {
  host: string;
  port: number;
  dataDir: string;
  startId?: number;
  transport: TransportSettings;
  homeAssistant: HomeAssistantSettings;
  mqtt?: MqttConfig;
}

export interface MqttConfig {
  url?: string;
  username?: string;
  password?: string;
  tls?: boolean;
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
