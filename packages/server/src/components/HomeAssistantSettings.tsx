import { type FormEvent } from 'react';
import type { HomeAssistantResponse, SettingsFormMessage } from '../ui/types';
import { SettingsActions, SettingsLayout } from './SettingsLayout';

export function HomeAssistantSettings({
  settings,
  message,
  saving,
  onChange,
  onSave,
}: {
  settings: HomeAssistantResponse;
  message: SettingsFormMessage;
  saving: boolean;
  onChange: (settings: HomeAssistantResponse) => void;
  onSave: (settings: HomeAssistantResponse) => void;
}) {
  const update = <K extends keyof HomeAssistantResponse>(key: K, value: HomeAssistantResponse[K]) =>
    onChange({ ...settings, [key]: value });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(settings);
  };

  return (
    <SettingsLayout
      description="Discovery and availability topics for Home Assistant."
      status={settings.enabled ? 'Enabled' : 'Disabled'}
      statusTone={settings.enabled ? 'online' : 'neutral'}
      title="Home Assistant"
    >
      <form
        className="settings-panel settings-form"
        onSubmit={submit}
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
      </form>
    </SettingsLayout>
  );
}
