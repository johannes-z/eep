import type { HomeAssistantResponse } from '../ui/types';
import { useSettingsForm } from '../ui/useSettingsForm';
import { SettingsActions, SettingsForm, SettingsLayout } from './SettingsLayout';

export function HomeAssistantSettings({ settings: live }: { settings: HomeAssistantResponse }) {
  const { settings, message, saving, onChange, onSave } = useSettingsForm(
    live,
    '/api/homeassistant',
  );
  const update = <K extends keyof HomeAssistantResponse>(key: K, value: HomeAssistantResponse[K]) =>
    onChange({ ...settings, [key]: value });

  return (
    <SettingsLayout
      status={live.enabled ? 'Enabled' : 'Disabled'}
      statusTone={live.enabled ? 'online' : 'neutral'}
      title="Home Assistant"
    >
      <SettingsForm
        saving={saving}
        onSubmit={() => onSave(settings)}
      >
        <div className="form-section">
          <h3>Integration</h3>
        </div>
        <label className="setting-field wide">
          <span>Discovery topic</span>
          <input
            onChange={(event) => update('discovery_topic', event.target.value)}
            value={settings.discovery_topic}
          />
        </label>
        <label className="setting-field wide">
          <span>Status topic</span>
          <input
            onChange={(event) => update('status_topic', event.target.value)}
            value={settings.status_topic}
          />
        </label>
        <label className="setting-field wide">
          <span>Log level</span>
          <select
            onChange={(event) =>
              update('log_level', event.target.value as HomeAssistantResponse['log_level'])
            }
            value={settings.log_level}
          >
            <option value="debug">Debug</option>
            <option value="info">Info</option>
            <option value="warn">Warn</option>
            <option value="error">Error</option>
          </select>
        </label>
        <label className="switch-field standalone-switch">
          <input
            checked={settings.enabled}
            onChange={(event) => update('enabled', event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Enabled</strong>
            <small>Publish discovery entities</small>
          </span>
        </label>
        <SettingsActions
          label="Save Home Assistant"
          message={message}
          saving={saving}
        />
      </SettingsForm>
    </SettingsLayout>
  );
}
