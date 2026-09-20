export type AppView =
  | 'overview'
  | 'packet-listener'
  | 'settings'
  | 'mqtt'
  | 'homeassistant'
  | 'general';

export interface EntityState {
  isOn: boolean;
  percentage?: number;
  preset?: string;
}

export interface EntityDescriptor {
  kind: string;
  protocol: string;
  power: boolean;
  commands: string[];
  percentage?: { min: number; max: number };
  presets?: string[];
}

export interface Device {
  sourceId: number;
  targetId: number;
  name: string;
  profileId: string;
  capabilities: unknown;
  profile?: {
    id: string;
    description: string;
    entity?: EntityDescriptor;
  };
  availability: 'online' | 'offline' | 'unknown';
  lastSeen?: string;
  reportedState?: unknown;
  desiredState?: unknown;
  entityState?: EntityState;
}

export interface TeachInCandidate {
  targetId: number;
  eep?: string;
}

export interface PairingResponse {
  active: boolean;
  candidates: TeachInCandidate[];
}

export interface ListenPacket {
  id: number;
  timestamp: string;
  direction: 'rx' | 'tx';
  packetType: number;
  data: string;
  optionalData: string;
  radio?: {
    rorg: number;
    payload: string;
    senderId: string;
    teachIn: boolean;
    eep?: string;
  };
}

export interface ListenResponse {
  active: boolean;
  packets: ListenPacket[];
}

export interface MqttResponse {
  configured: boolean;
  connected: boolean;
  error: string;
  server: string;
  user: string;
  passwordConfigured: boolean;
  base_topic: string;
  client_id: string;
  keepalive: number;
  version: 3 | 4 | 5;
  maximum_packet_size: number;
  tls: boolean;
  ca: string;
  cert: string;
  key: string;
  reject_unauthorized: boolean;
  force_disable_retain: boolean;
  include_device_information: boolean;
}

export interface MqttForm extends MqttResponse {
  password: string;
  clearPassword: boolean;
}

export interface TransportResponse {
  connected: boolean;
  type: 'none' | 'serial' | 'tcp';
  port: string;
  baudrate: number;
  rtscts: boolean;
  restartRequired?: boolean;
}

export interface GeneralResponse {
  start_id: string;
  base_id: string | null;
  channels: GeneralChannel[];
  restartRequired?: boolean;
}

export interface GeneralChannel {
  channel: number;
  id: string;
  used: boolean;
  device?: string;
}

export interface HomeAssistantResponse {
  enabled: boolean;
  discovery_topic: string;
  status_topic: string;
  log_level: 'debug' | 'info' | 'warn' | 'error';
  restartRequired?: boolean;
}

export interface SettingsFormMessage {
  text: string;
  error: boolean;
}

export type CommandBody = Record<string, unknown>;
