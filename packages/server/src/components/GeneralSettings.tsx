import { type FormEvent } from 'react';
import type { GeneralResponse, SettingsFormMessage } from '../ui/types';
import { SettingsActions, SettingsLayout } from './SettingsLayout';

export function GeneralSettings({
  settings,
  message,
  saving,
  onChange,
  onSave,
  onPairChannel,
  pairingSourceId,
  pairingMessage,
}: {
  settings: GeneralResponse;
  message: SettingsFormMessage;
  saving: boolean;
  onChange: (settings: GeneralResponse) => void;
  onSave: (settings: GeneralResponse) => void;
  onPairChannel: (sourceId: number) => void;
  pairingSourceId: number | null;
  pairingMessage: SettingsFormMessage;
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
      status={pairingSourceId === null ? 'Ready' : 'Pairing'}
      statusTone={pairingSourceId === null ? 'online' : 'warning'}
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
        <div className="channel-section">
          <div className="form-section">
            <h3>USB 300 channels</h3>
            <span className="channel-summary">
              {settings.channels.filter((channel) => channel.used).length} used /{' '}
              {settings.channels.filter((channel) => !channel.used).length} free
            </span>
          </div>
          {pairingMessage.text && (
            <p
              className={`channel-feedback ${pairingMessage.error ? 'error' : ''}`}
              role="status"
            >
              {pairingMessage.text}
            </p>
          )}
          <div className="data-table-wrap channel-table-wrap">
            <table className="data-table channel-table">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th>Sender address</th>
                  <th>Device</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {settings.channels.length ? (
                  settings.channels.map((channel) => (
                    <tr
                      className={channel.used ? 'used-row' : undefined}
                      key={channel.id}
                    >
                      <td data-label="Channel">CH {channel.channel.toString().padStart(3, '0')}</td>
                      <td data-label="Sender address">
                        <code>{channel.id}</code>
                      </td>
                      <td data-label="Device">{channel.device ?? 'Unassigned'}</td>
                      <td data-label="Status">
                        <span className={`availability ${channel.used ? 'unknown' : 'online'}`}>
                          <span className="status-dot" />
                          {channel.used ? 'Used' : 'Available'}
                        </span>
                      </td>
                      <td data-label="Actions">
                        {channel.used ? (
                          <span className="muted-copy">Assigned</span>
                        ) : (
                          <button
                            className="small-button"
                            disabled={pairingSourceId !== null}
                            onClick={() => onPairChannel(Number.parseInt(channel.id, 16))}
                            type="button"
                          >
                            {pairingSourceId === Number.parseInt(channel.id, 16)
                              ? 'Pairing...'
                              : 'Pair'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      className="empty-table"
                      colSpan={5}
                    >
                      USB 300 channels unavailable.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <SettingsActions
          label="Save general"
          message={message}
          saving={saving}
        />
      </form>
    </SettingsLayout>
  );
}
