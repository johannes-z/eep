export type AppView = 'overview' | 'settings' | 'mqtt' | 'homeassistant';

export interface FanState {
  isOn: boolean;
  percentage: number;
  d2Value: number;
  preset?: string;
}

export interface Device {
  targetId: number;
  name: string;
  roomName: string;
  protocol: string;
  supportedFunctions: string[];
  availability: 'online' | 'offline' | 'unknown';
  lastSeen?: string;
  reportedState?: FanState;
  desiredState?: FanState;
}

export interface TeachInCandidate {
  targetId: number;
  eep?: string;
}

export interface PairingResponse {
  active: boolean;
  candidates: TeachInCandidate[];
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
  type: 'none' | 'serial' | 'tcp';
  port: string;
  baudrate: number;
  rtscts: boolean;
  restartRequired?: boolean;
}

export interface HomeAssistantResponse {
  enabled: boolean;
  discovery_topic: string;
  status_topic: string;
  experimental_event_entities: boolean;
  legacy_action_sensor: boolean;
  restartRequired?: boolean;
}

export interface SettingsFormMessage {
  text: string;
  error: boolean;
}

export type CommandBody = { percentage: number } | { isOn: boolean } | { preset: string };
