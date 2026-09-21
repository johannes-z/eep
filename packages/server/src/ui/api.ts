import { queryOptions, type QueryClient } from '@tanstack/react-query';
import type { AppSnapshot } from './types';

export async function request<Result = unknown>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<Result> {
  const response = await fetch(path, {
    method,
    signal,
    ...(body === undefined
      ? {}
      : {
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        }),
  });
  const payload = (await response.json()) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? `Request failed with ${response.status}`);
  return payload as Result;
}

export const snapshotQueryOptions = queryOptions({
  queryKey: ['snapshot'],
  queryFn: async ({ signal }): Promise<AppSnapshot> => {
    const [devices, general, transport, homeAssistant, mqtt, pairing, listen] = await Promise.all([
      request<AppSnapshot['devices']>('/api/devices', 'GET', undefined, signal),
      request<AppSnapshot['general']>('/api/general', 'GET', undefined, signal),
      request<AppSnapshot['transport']>('/api/settings', 'GET', undefined, signal),
      request<AppSnapshot['homeAssistant']>('/api/homeassistant', 'GET', undefined, signal),
      request<AppSnapshot['mqtt']>('/api/mqtt', 'GET', undefined, signal),
      request<AppSnapshot['pairing']>('/api/pairing', 'GET', undefined, signal),
      request<AppSnapshot['listen']>('/api/listen', 'GET', undefined, signal),
    ]);
    return { devices, general, transport, homeAssistant, mqtt, pairing, listen };
  },
});

export function cacheLiveSnapshot(queryClient: QueryClient, snapshot: AppSnapshot) {
  void queryClient.cancelQueries({ queryKey: snapshotQueryOptions.queryKey });
  queryClient.setQueryData(snapshotQueryOptions.queryKey, snapshot);
}
