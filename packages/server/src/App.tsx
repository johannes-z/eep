import { Outlet, useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useEffect, useState } from 'react';
import { HomeAssistantSettings } from './components/HomeAssistantSettings';
import { MqttSettings, type MqttSaveResult } from './components/MqttSettings';
import { Overview } from './components/Overview';
import { PacketListener } from './components/PacketListener';
import { Sidebar, TopBar } from './components/Navigation';
import { TransportSettings } from './components/TransportSettings';
import { formatTargetId } from './components/deviceUtils';
import { getAppRoute } from './ui/routes';
import type {
  CommandBody,
  Device,
  HomeAssistantResponse,
  ListenResponse,
  MqttForm,
  MqttResponse,
  PairingResponse,
  SettingsFormMessage,
  TeachInCandidate,
  TransportResponse,
} from './ui/types';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const payload = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed with ${response.status}`);
  return payload as T;
}

function toMqttForm(settings: MqttResponse): MqttForm {
  return { ...settings, password: '', clearPassword: false };
}

export interface AppContextValue {
  busyTarget: number | null;
  candidates: TeachInCandidate[];
  devices: Device[];
  homeAssistant: HomeAssistantResponse | null;
  homeAssistantMessage: SettingsFormMessage;
  listen: ListenResponse | null;
  mqtt: MqttForm | null;
  mqttMessage: SettingsFormMessage;
  onAcceptCandidate: (candidate: TeachInCandidate) => void;
  onCommand: (sourceId: number, body: CommandBody) => void;
  onHomeAssistantChange: (settings: HomeAssistantResponse) => void;
  onListen: () => void;
  onMqttChange: (settings: MqttForm) => void;
  onPairing: () => void;
  onTransmitPairing: () => void;
  onDeleteDevice: (sourceId: number) => Promise<void>;
  onSaveHomeAssistant: (settings: HomeAssistantResponse) => void;
  onSaveMqtt: (settings: MqttForm) => void;
  onSaveTransport: (settings: TransportResponse) => void;
  onTransportChange: (settings: TransportResponse) => void;
  pairing: boolean;
  savingHomeAssistant: boolean;
  savingMqtt: boolean;
  savingTransport: boolean;
  transport: TransportResponse | null;
  transportMessage: SettingsFormMessage;
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext(): AppContextValue {
  const context = useContext(AppContext);
  if (!context) throw new Error('App context is unavailable');
  return context;
}

export function App() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { title } = getAppRoute(pathname);
  const [devices, setDevices] = useState<Device[]>([]);
  const [pairing, setPairing] = useState(false);
  const [candidates, setCandidates] = useState<TeachInCandidate[]>([]);
  const [transport, setTransport] = useState<TransportResponse | null>(null);
  const [homeAssistant, setHomeAssistant] = useState<HomeAssistantResponse | null>(null);
  const [listen, setListen] = useState<ListenResponse | null>(null);
  const [mqtt, setMqtt] = useState<MqttForm | null>(null);
  const [busyTarget, setBusyTarget] = useState<number | null>(null);
  const [savingTransport, setSavingTransport] = useState(false);
  const [savingHomeAssistant, setSavingHomeAssistant] = useState(false);
  const [savingMqtt, setSavingMqtt] = useState(false);
  const [transportMessage, setTransportMessage] = useState<SettingsFormMessage>({
    text: '',
    error: false,
  });
  const [homeAssistantMessage, setHomeAssistantMessage] = useState<SettingsFormMessage>({
    text: '',
    error: false,
  });
  const [mqttMessage, setMqttMessage] = useState<SettingsFormMessage>({
    text: '',
    error: false,
  });
  const [error, setError] = useState('');

  async function loadDevices() {
    setDevices(await request<Device[]>('/api/devices'));
  }

  async function loadPairing() {
    const response = await request<PairingResponse>('/api/pairing');
    setPairing(response.active);
    setCandidates(response.candidates ?? []);
  }

  async function loadMqtt() {
    const latest = await request<MqttResponse>('/api/mqtt');
    setMqtt((current) =>
      current
        ? {
            ...current,
            configured: latest.configured,
            connected: latest.connected,
            error: latest.error,
            passwordConfigured: latest.passwordConfigured,
          }
        : toMqttForm(latest),
    );
    setMqttMessage((current) => {
      if (current.text !== 'Saved. MQTT is connecting...') return current;
      if (latest.connected) return { text: 'Saved. MQTT is connected.', error: false };
      if (latest.error) return { text: latest.error, error: true };
      return current;
    });
  }

  async function loadTransport() {
    setTransport(await request<TransportResponse>('/api/settings'));
  }

  async function loadHomeAssistant() {
    setHomeAssistant(await request<HomeAssistantResponse>('/api/homeassistant'));
  }

  async function loadListen() {
    setListen(await request<ListenResponse>('/api/listen'));
  }

  useEffect(() => {
    void Promise.all([
      loadDevices(),
      loadPairing(),
      loadMqtt(),
      loadTransport(),
      loadHomeAssistant(),
      loadListen(),
    ]).catch((reason: unknown) =>
      setError(reason instanceof Error ? reason.message : 'Server unavailable'),
    );
    const timer = window.setInterval(() => {
      void loadDevices().catch(() => undefined);
      void loadPairing().catch(() => undefined);
      void loadMqtt().catch(() => undefined);
      void loadTransport().catch(() => undefined);
      void loadListen().catch(() => undefined);
    }, 3000);
    return () => window.clearInterval(timer);
  }, []);

  async function togglePairing() {
    setError('');
    try {
      await request<PairingResponse>(`/api/pairing/${pairing ? 'stop' : 'start'}`, {
        method: 'POST',
      });
      await loadPairing();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change pairing state');
    }
  }

  async function toggleListen() {
    setError('');
    try {
      const action = listen?.active ? 'stop' : 'start';
      setListen(await request<ListenResponse>(`/api/listen/${action}`, { method: 'POST' }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to change listen state');
    }
  }

  async function transmitPairing() {
    setError('');
    try {
      await request<PairingResponse>('/api/pairing/transmit', { method: 'POST' });
      await loadPairing();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to send pairing signal');
    }
  }

  async function acceptCandidate(candidate: TeachInCandidate) {
    try {
      await request('/api/pairing/accept', {
        body: JSON.stringify({
          targetId: candidate.targetId,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await Promise.all([loadDevices(), loadPairing()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to accept device');
    }
  }

  async function command(sourceId: number, body: CommandBody) {
    setBusyTarget(sourceId);
    setError('');
    try {
      await request(`/api/devices/${sourceId}/command`, {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await loadDevices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Command rejected');
    } finally {
      setBusyTarget(null);
    }
  }

  async function deleteDevice(sourceId: number) {
    setBusyTarget(sourceId);
    setError('');
    try {
      await request(`/api/devices/${sourceId}`, { method: 'DELETE' });
      await loadDevices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to delete device');
      throw reason;
    } finally {
      setBusyTarget(null);
    }
  }

  async function saveMqtt(settings: MqttForm) {
    setSavingMqtt(true);
    setMqttMessage({ text: 'Saving...', error: false });
    const body: Record<string, unknown> = {
      base_topic: settings.base_topic,
      ca: settings.ca,
      cert: settings.cert,
      client_id: settings.client_id,
      force_disable_retain: settings.force_disable_retain,
      include_device_information: settings.include_device_information,
      keepalive: settings.keepalive,
      key: settings.key,
      maximum_packet_size: settings.maximum_packet_size,
      reject_unauthorized: settings.reject_unauthorized,
      server: settings.server,
      tls: settings.tls,
      user: settings.user,
      version: settings.version,
    };
    if (settings.password) body.password = settings.password;
    if (settings.clearPassword) body.clear_password = true;
    try {
      const result = await request<MqttSaveResult>('/api/mqtt', {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      setMqtt(toMqttForm(result));
      setMqttMessage({
        text: result.connected
          ? 'Saved. MQTT is connected.'
          : result.error || 'Saved. MQTT is connecting...',
        error: Boolean(result.error),
      });
    } catch (reason) {
      setMqttMessage({
        text: reason instanceof Error ? reason.message : 'Unable to save MQTT settings',
        error: true,
      });
    } finally {
      setSavingMqtt(false);
    }
  }

  async function saveTransport(settings: TransportResponse) {
    setSavingTransport(true);
    setTransportMessage({ text: 'Saving...', error: false });
    try {
      const result = await request<TransportResponse>('/api/settings', {
        body: JSON.stringify({
          baudrate: settings.baudrate,
          port: settings.port,
          rtscts: settings.rtscts,
          type: settings.type,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      setTransport(result);
      setTransportMessage({
        text: result.restartRequired ? 'Saved. Restart required.' : 'Saved. Transport applied.',
        error: false,
      });
    } catch (reason) {
      setTransportMessage({
        text: reason instanceof Error ? reason.message : 'Unable to save transport settings',
        error: true,
      });
    } finally {
      setSavingTransport(false);
    }
  }

  async function saveHomeAssistant(settings: HomeAssistantResponse) {
    setSavingHomeAssistant(true);
    setHomeAssistantMessage({ text: 'Saving...', error: false });
    try {
      const result = await request<HomeAssistantResponse>('/api/homeassistant', {
        body: JSON.stringify({
          discovery_topic: settings.discovery_topic,
          enabled: settings.enabled,
          experimental_event_entities: settings.experimental_event_entities,
          legacy_action_sensor: settings.legacy_action_sensor,
          status_topic: settings.status_topic,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      setHomeAssistant(result);
      setHomeAssistantMessage({
        text: result.restartRequired
          ? 'Saved. Restart required.'
          : 'Saved. Home Assistant applied.',
        error: false,
      });
    } catch (reason) {
      setHomeAssistantMessage({
        text: reason instanceof Error ? reason.message : 'Unable to save Home Assistant settings',
        error: true,
      });
    } finally {
      setSavingHomeAssistant(false);
    }
  }

  const context: AppContextValue = {
    busyTarget,
    candidates,
    devices,
    homeAssistant,
    homeAssistantMessage,
    listen,
    mqtt,
    mqttMessage,
    onAcceptCandidate: acceptCandidate,
    onCommand: command,
    onHomeAssistantChange: setHomeAssistant,
    onListen: toggleListen,
    onMqttChange: setMqtt,
    onPairing: togglePairing,
    onTransmitPairing: transmitPairing,
    onDeleteDevice: deleteDevice,
    onSaveHomeAssistant: saveHomeAssistant,
    onSaveMqtt: saveMqtt,
    onSaveTransport: saveTransport,
    onTransportChange: setTransport,
    pairing,
    savingHomeAssistant,
    savingMqtt,
    savingTransport,
    transport,
    transportMessage,
  };

  return (
    <AppContext.Provider value={context}>
      <div className="app-shell">
        <Sidebar
          mqtt={mqtt}
          transport={transport}
        />
        <main className="main-content">
          <TopBar
            onPairing={togglePairing}
            pairing={pairing}
            title={title}
          />
          {error && (
            <div
              className="error-banner"
              role="alert"
            >
              {error}
            </div>
          )}
          <div className="page-content">
            <Outlet />
          </div>
        </main>
      </div>
    </AppContext.Provider>
  );
}
