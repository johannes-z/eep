import { startTransition, useActionState, useState } from 'react';
import { request } from './api';
import type { SettingsFormMessage } from './types';

export function useSettingsForm<Settings>(
  live: Settings,
  path: string,
  serialize: (settings: Settings) => unknown = (settings) => settings,
) {
  const [draft, setDraft] = useState<Settings | null>(null);
  const [message, save, saving] = useActionState<SettingsFormMessage, Settings>(
    async (_previous, settings) => {
      try {
        const result = await request<{ restartRequired?: boolean }>(
          path,
          'PUT',
          serialize(settings),
        );
        setDraft(null);
        return {
          text: result.restartRequired ? 'Saved. Restart required.' : 'Saved.',
          error: false,
        };
      } catch (reason) {
        return {
          text: reason instanceof Error ? reason.message : 'Unable to save settings',
          error: true,
        };
      }
    },
    { text: '', error: false },
  );
  return {
    settings: draft ?? live,
    onChange: setDraft,
    onSave: (settings: Settings) => startTransition(() => save(settings)),
    message,
    saving,
  };
}
