import { useEffect, useState } from 'react';
import { HomeAssistantSettings } from './components/HomeAssistantSettings';
import { MqttSettings, type MqttSaveResult } from './components/MqttSettings';
import { Overview } from './components/Overview';
import { Sidebar, TopBar } from './components/Navigation';
import { TransportSettings } from './components/TransportSettings';
import { formatTargetId } from './components/deviceUtils';
import type {
  AppView,
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

export function App() {
  const [view, setView] = useState<AppView>('overview');
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

  async function acceptCandidate(candidate: TeachInCandidate) {
    try {
      await request('/api/pairing/accept', {
        body: JSON.stringify({
          targetId: candidate.targetId,
          roomId: 'NEW',
          roomName: 'New devices',
          key: `fan-${candidate.targetId}`,
          name: `New fan ${formatTargetId(candidate.targetId)}`,
        }),
        headers: { 'content-type': 'application/json' },
        method: 'POST',
      });
      await Promise.all([loadDevices(), loadPairing()]);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to accept device');
    }
  }

  async function command(targetId: number, body: CommandBody) {
    setBusyTarget(targetId);
    setError('');
    try {
      await request(`/api/devices/${targetId}/command`, {
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

  async function renameDevice(targetId: number, name: string) {
    setError('');
    try {
      await request(`/api/devices/${targetId}`, {
        body: JSON.stringify({ name }),
        headers: { 'content-type': 'application/json' },
        method: 'PUT',
      });
      await loadDevices();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to rename device');
      throw reason;
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

  return (
    <div className="app-shell">
      <Sidebar
        onView={setView}
        view={view}
      />
      <main className="main-content">
        <TopBar
          onPairing={togglePairing}
          pairing={pairing}
          view={view}
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
          {view === 'overview' ? (
            <Overview
              busyTarget={busyTarget}
              candidates={candidates}
              devices={devices}
              listen={listen}
              mqtt={mqtt}
              onAccept={acceptCandidate}
              onCommand={command}
              onListen={toggleListen}
              onRename={renameDevice}
              onPairing={togglePairing}
              pairing={pairing}
            />
          ) : view === 'settings' && transport ? (
            <TransportSettings
              message={transportMessage}
              onChange={setTransport}
              onSave={saveTransport}
              saving={savingTransport}
              settings={transport}
            />
          ) : view === 'homeassistant' && homeAssistant ? (
            <HomeAssistantSettings
              message={homeAssistantMessage}
              onChange={setHomeAssistant}
              onSave={saveHomeAssistant}
              saving={savingHomeAssistant}
              settings={homeAssistant}
            />
          ) : mqtt ? (
            <MqttSettings
              message={mqttMessage}
              onChange={setMqtt}
              onSave={saveMqtt}
              saving={savingMqtt}
              settings={mqtt}
            />
          ) : (
            <div className="loading-state">Loading...</div>
          )}
        </div>
      </main>
    </div>
  );
}
