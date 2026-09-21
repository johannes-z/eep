import type { Device as RegisteredDevice } from '../devices/types';
import type { ProfileEntityDescriptor, ProfileEntityState } from '../profiles/types';
export type { ListenPacket, ListenSnapshot as ListenResponse } from '../transport/listener';
import type { ListenSnapshot } from '../transport/listener';
import type { DongleVersion } from '../transport/esp3';

export type AppView =
  | 'devices'
  | 'pairing'
  | 'packet-listener'
  | 'settings'
  | 'mqtt'
  | 'homeassistant';

export interface Device extends RegisteredDevice {
  profile?: {
    id: string;
    description: string;
    entity?: ProfileEntityDescriptor;
  };
  entityState?: ProfileEntityState;
}

export interface TeachInCandidate {
  targetId: number;
  eep?: string;
  profileOptions?: string[];
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
  connected: boolean;
  hardware: DongleVersion | null;
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

export interface AppSnapshot {
  devices: Device[];
  general: GeneralResponse;
  transport: TransportResponse;
  homeAssistant: HomeAssistantResponse;
  mqtt: MqttResponse;
  pairing: PairingResponse;
  listen: ListenSnapshot;
}

export type CommandBody = Record<string, unknown>;
