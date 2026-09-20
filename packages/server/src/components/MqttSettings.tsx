import type { MqttForm, MqttResponse } from '../ui/types';
import { useSettingsForm } from '../ui/useSettingsForm';
import { SettingsActions, SettingsForm, SettingsLayout } from './SettingsLayout';

export function MqttSettings({ settings: live }: { settings: MqttResponse }) {
  const { settings, message, saving, onChange, onSave } = useSettingsForm<MqttForm>(
    { ...live, password: '', clearPassword: false },
    '/api/mqtt',
    ({ clearPassword, ...values }) => ({ ...values, clear_password: clearPassword }),
  );
  const update = <K extends keyof MqttForm>(key: K, value: MqttForm[K]) =>
    onChange({ ...settings, [key]: value });
  const status = live.connected
    ? 'Connected'
    : live.error
      ? 'Error'
      : live.configured
        ? 'Connecting'
        : 'Not configured';

  return (
    <SettingsLayout
      status={status}
      statusTone={live.connected ? 'online' : live.error ? 'error' : 'neutral'}
      title="MQTT"
    >
      <SettingsForm
        saving={saving}
        onSubmit={() => onSave(settings)}
      >
        <div className="form-section">
          <h3>Broker</h3>
        </div>
        <label className="setting-field wide">
          <span>Server</span>
          <input
            onChange={(event) => update('server', event.target.value)}
            placeholder="mqtt://broker:1883"
            type="url"
            value={settings.server}
          />
        </label>
        <label className="setting-field">
          <span>User</span>
          <input
            autoComplete="username"
            onChange={(event) => update('user', event.target.value)}
            value={settings.user}
          />
        </label>
        <label className="setting-field">
          <span>Password</span>
          <input
            autoComplete="new-password"
            onChange={(event) => update('password', event.target.value)}
            placeholder={settings.passwordConfigured ? 'Saved password' : 'Password'}
            type="password"
            value={settings.password}
          />
        </label>
        <label className="setting-field">
          <span>Base topic</span>
          <input
            onChange={(event) => update('base_topic', event.target.value)}
            value={settings.base_topic}
          />
        </label>
        <label className="setting-field">
          <span>Client ID</span>
          <input
            onChange={(event) => update('client_id', event.target.value)}
            value={settings.client_id}
          />
        </label>
        <div className="form-section section-spaced">
          <h3>Protocol</h3>
        </div>
        <label className="setting-field">
          <span>Keepalive</span>
          <input
            max="65535"
            min="0"
            onChange={(event) => update('keepalive', Number(event.target.value))}
            type="number"
            value={settings.keepalive}
          />
        </label>
        <label className="setting-field">
          <span>Version</span>
          <select
            onChange={(event) => update('version', Number(event.target.value) as 3 | 4 | 5)}
            value={settings.version}
          >
            <option value="3">3.1</option>
            <option value="4">3.1.1</option>
            <option value="5">5</option>
          </select>
        </label>
        <label className="setting-field">
          <span>Maximum packet size</span>
          <input
            max="268435460"
            min="1"
            onChange={(event) => update('maximum_packet_size', Number(event.target.value))}
            type="number"
            value={settings.maximum_packet_size}
          />
        </label>
        <div className="form-section section-spaced">
          <h3>TLS</h3>
        </div>
        <label className="setting-field wide">
          <span>CA</span>
          <input
            onChange={(event) => update('ca', event.target.value)}
            placeholder="/data/certs/ca.crt"
            value={settings.ca}
          />
        </label>
        <label className="setting-field">
          <span>Certificate</span>
          <input
            onChange={(event) => update('cert', event.target.value)}
            placeholder="/data/certs/client.crt"
            value={settings.cert}
          />
        </label>
        <label className="setting-field wide">
          <span>Key</span>
          <input
            onChange={(event) => update('key', event.target.value)}
            placeholder="/data/certs/client.key"
            value={settings.key}
          />
        </label>
        <div className="switch-grid">
          <label className="switch-field">
            <input
              checked={settings.tls}
              onChange={(event) => update('tls', event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>TLS</strong>
              <small>Secure the broker connection</small>
            </span>
          </label>
          <label className="switch-field">
            <input
              checked={settings.reject_unauthorized}
              onChange={(event) => update('reject_unauthorized', event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Reject unauthorized</strong>
              <small>Validate broker certificates</small>
            </span>
          </label>
          <label className="switch-field">
            <input
              checked={settings.force_disable_retain}
              onChange={(event) => update('force_disable_retain', event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Disable retain</strong>
              <small>Do not retain MQTT messages</small>
            </span>
          </label>
          <label className="switch-field">
            <input
              checked={settings.include_device_information}
              onChange={(event) => update('include_device_information', event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Device information</strong>
              <small>Include metadata in discovery</small>
            </span>
          </label>
          <label className="switch-field">
            <input
              checked={settings.clearPassword}
              onChange={(event) => update('clearPassword', event.target.checked)}
              type="checkbox"
            />
            <span>
              <strong>Clear password</strong>
              <small>Remove the stored password</small>
            </span>
          </label>
        </div>
        <SettingsActions
          label="Save MQTT"
          message={message}
          saving={saving}
        />
      </SettingsForm>
    </SettingsLayout>
  );
}
