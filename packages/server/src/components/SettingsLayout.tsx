import type { ReactNode } from 'react';

export function SettingsLayout({
  title,
  description,
  status,
  statusTone = 'neutral',
  children,
}: {
  title: string;
  description: string;
  status: string;
  statusTone?: 'neutral' | 'online' | 'warning' | 'error';
  children: ReactNode;
}) {
  return (
    <section className="settings-view">
      <div className="settings-heading">
        <div>
          <h2>{title}</h2>
          <p>{description}</p>
        </div>
        <span className={`settings-status ${statusTone}`}>
          <span className="status-dot" />
          {status}
        </span>
      </div>
      {children}
    </section>
  );
}

export function SettingsActions({
  saving,
  message,
  label = 'Save changes',
}: {
  saving: boolean;
  message: { text: string; error: boolean };
  label?: string;
}) {
  return (
    <div className="settings-actions">
      <button
        className="save-button"
        disabled={saving}
        type="submit"
      >
        {saving ? 'Saving...' : label}
      </button>
      <span className={message.error ? 'form-message error' : 'form-message'}>{message.text}</span>
    </div>
  );
}
