import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { request, snapshotQueryOptions } from './api';
import type { SettingsFormMessage } from './types';

export function useSettingsForm<Settings>(
  live: Settings,
  path: string,
  serialize: (settings: Settings) => unknown = (settings) => settings,
) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Settings | null>(null);
  const save = useMutation({
    mutationFn: (settings: Settings) =>
      request<{ restartRequired?: boolean }>(path, 'PUT', serialize(settings)),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: snapshotQueryOptions.queryKey });
      setDraft(null);
    },
  });
  const message: SettingsFormMessage = save.isError
    ? { text: save.error.message, error: true }
    : save.isSuccess
      ? { text: save.data.restartRequired ? 'Saved. Restart required.' : 'Saved.', error: false }
      : { text: '', error: false };
  return {
    settings: draft ?? live,
    onChange: setDraft,
    onSave: (settings: Settings) => save.mutate(settings),
    message,
    saving: save.isPending,
  };
}
