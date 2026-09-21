import type { GeneralResponse, TransportResponse } from '../ui/types';
import { useSettingsForm } from '../ui/useSettingsForm';
import { SettingsActions, SettingsForm, SettingsLayout } from './SettingsLayout';

export function TransportSettings({
  settings: live,
  general,
}: {
  settings: TransportResponse;
  general: GeneralResponse;
}) {
  const { settings, message, saving, onChange, onSave } = useSettingsForm(live, '/api/settings');
  const update = <K extends keyof TransportResponse>(key: K, value: TransportResponse[K]) =>
    onChange({ ...settings, [key]: value });
  const status = live.type === 'none' ? 'Disabled' : live.connected ? 'Connected' : 'Disconnected';
  const hardware = live.connected ? live.hardware : null;
  const hardwareFields = [
    { label: 'Application description', value: hardware?.description },
    { label: 'Base ID', value: live.connected ? general.base_id : null },
    { label: 'Application firmware version', value: hardware?.applicationVersion },
    { label: 'API version', value: hardware?.apiVersion },
    { label: 'Chip ID', value: hardware?.chipId },
    { label: 'Chip version', value: hardware?.chipVersion },
  ];

  return (
    <SettingsLayout
      status={status}
      statusTone={live.type === 'none' ? 'neutral' : live.connected ? 'online' : 'error'}
      title="Transport & dongle"
    >
      <SettingsForm
        saving={saving}
        onSubmit={() => onSave(settings)}
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
      </SettingsForm>
      <fieldset className="settings-panel settings-form">
        <div className="form-section">
          <h3>Hardware Information</h3>
        </div>
        {hardwareFields.map(({ label, value }) => (
          <label
            className="setting-field"
            key={label}
          >
            <span>{label}</span>
            <input
              readOnly
              value={value || 'Unavailable'}
            />
          </label>
        ))}
      </fieldset>
    </SettingsLayout>
  );
}
