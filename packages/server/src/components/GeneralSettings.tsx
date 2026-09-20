import { type FormEvent } from 'react';
import type { GeneralResponse, SettingsFormMessage } from '../ui/types';
import { SettingsActions, SettingsLayout } from './SettingsLayout';

export function GeneralSettings({
  settings,
  message,
  saving,
  onChange,
  onSave,
}: {
  settings: GeneralResponse;
  message: SettingsFormMessage;
  saving: boolean;
  onChange: (settings: GeneralResponse) => void;
  onSave: (settings: GeneralResponse) => void;
}) {
  const update = <K extends keyof GeneralResponse>(key: K, value: GeneralResponse[K]) =>
    onChange({ ...settings, [key]: value });
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave(settings);
  };

  return (
    <SettingsLayout
      description="Configure the first EnOcean sender ID used for automatic teach-in."
      status="Ready"
      statusTone="online"
      title="General"
    >
      <form
        className="settings-panel settings-form"
        onSubmit={submit}
      >
        <div className="form-section">
          <h3>Sender ID allocation</h3>
        </div>
        <label className="setting-field">
          <span>Start ID</span>
          <input
            inputMode="text"
            maxLength={8}
            onChange={(event) => update('start_id', event.target.value)}
            pattern="[0-9a-fA-F]{1,8}"
            placeholder="ffe76681"
            spellCheck={false}
            value={settings.start_id}
          />
        </label>
        <label className="setting-field">
          <span>USB 300 base ID</span>
          <input
            readOnly
            spellCheck={false}
            value={settings.base_id ?? 'Unavailable'}
          />
        </label>
        <SettingsActions
          label="Save general"
          message={message}
          saving={saving}
        />
      </form>
    </SettingsLayout>
  );
}
