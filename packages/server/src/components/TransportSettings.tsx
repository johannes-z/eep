import { type FormEvent } from 'react';
import type { SettingsFormMessage, TransportResponse } from '../ui/types';
import { SettingsActions, SettingsLayout } from './SettingsLayout';

export function TransportSettings({
  settings,
  message,
  saving,
  onChange,
  onSave,
}: {
  settings: TransportResponse;
  message: SettingsFormMessage;
  saving: boolean;
  onChange: (settings: TransportResponse) => void;
  onSave: (settings: TransportResponse) => void;
}) {
  const update = <K extends keyof TransportResponse>(key: K, value: TransportResponse[K]) =>
    onChange({ ...settings, [key]: value });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(settings);
  };
  const status =
    settings.type === 'none' ? 'Disabled' : settings.connected ? 'Connected' : 'Disconnected';

  return (
    <SettingsLayout
      description="Connection settings for the EnOcean transport."
      status={status}
      statusTone={settings.type === 'none' ? 'neutral' : settings.connected ? 'online' : 'error'}
      title="Transport"
    >
      <form
        className="settings-panel settings-form"
        onSubmit={submit}
      >
        <div className="form-section">
          <h3>Connection</h3>
        </div>
        <label className="setting-field">
          <span>Type</span>
          <select
            onChange={(event) => update('type', event.target.value as TransportResponse['type'])}
            value={settings.type}
          >
            <option value="none">Disabled</option>
            <option value="serial">Serial</option>
            <option value="tcp">TCP</option>
          </select>
        </label>
        <label className="setting-field wide">
          <span>Port</span>
          <input
            disabled={settings.type === 'none'}
            onChange={(event) => update('port', event.target.value)}
            placeholder={settings.type === 'tcp' ? 'tcp://192.168.1.49:20108' : '/dev/ttyUSB0'}
            value={settings.port}
          />
        </label>
        <label className="setting-field">
          <span>Baud rate</span>
          <input
            disabled={settings.type !== 'serial'}
            min="1"
            onChange={(event) => update('baudrate', Number(event.target.value))}
            type="number"
            value={settings.baudrate}
          />
        </label>
        <label className="switch-field standalone-switch">
          <input
            checked={settings.rtscts}
            disabled={settings.type !== 'serial'}
            onChange={(event) => update('rtscts', event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>RTS/CTS</strong>
            <small>Hardware flow control</small>
          </span>
        </label>
        <SettingsActions
          label="Save transport"
          message={message}
          saving={saving}
        />
      </form>
    </SettingsLayout>
  );
}
