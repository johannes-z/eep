import { useMutation, useMutationState, useQueryClient } from '@tanstack/react-query';
import { Outlet, useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import { Sidebar, TopBar } from '../components/Navigation';
import { formatEnOceanId } from '../util';
import { deviceTransmitId } from '../devices/types';
import { request, snapshotQueryOptions } from './api';
import { useLiveSnapshot } from './liveSnapshot';
import { findAppRoute } from './routes';
import type { AppSnapshot, CommandBody, TeachInCandidate } from './types';

interface AppContextValue extends AppSnapshot {
  busyTargets: ReadonlySet<number>;
  onCommand: (sourceId: number, body: CommandBody) => void;
  onDeleteDevice: (sourceId: number) => Promise<void>;
  onRenameDevice: (sourceId: number, name: string) => Promise<void>;
  onPairChannel: (sourceId: number) => void;
  onCancelPairing: () => void;
  onAcceptCandidate: (candidate: TeachInCandidate, profileId?: string) => void;
  onRejectCandidate: (candidate: TeachInCandidate) => void;
  onIgnoreCandidate: (candidate: TeachInCandidate) => void;
  onClearIgnoredDevice: (targetId: number) => void;
  pairingSourceId: number | null;
  pairingMessage: { text: string; error: boolean };
}

const AppContext = createContext<AppContextValue | null>(null);

interface AppRequest {
  path: string;
  method?: 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  sourceId?: number;
}

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('App context is unavailable');
  return context;
}

export function App() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const queryClient = useQueryClient();
  const { snapshot, status, error: queryError } = useLiveSnapshot();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [error, setError] = useState('');
  const action = useMutation({
    mutationKey: ['app-action'],
    mutationFn: ({ path, method = 'POST', body }: AppRequest) => request(path, method, body),
    onMutate: () => setError(''),
    onError: (reason) => setError(reason.message),
    onSettled: () => queryClient.invalidateQueries({ queryKey: snapshotQueryOptions.queryKey }),
  });
  const pendingTargets = useMutationState({
    filters: { mutationKey: ['app-action'], status: 'pending' },
    select: (mutation) => (mutation.state.variables as AppRequest).sourceId,
  });
  const busyTargets = new Set(pendingTargets.filter((sourceId) => sourceId !== undefined));
  const [pairingRequest, setPairingRequest] = useState<{
    sourceId: number;
    sending: boolean;
  } | null>(null);

  async function deviceRequest(
    sourceId: number,
    method: AppRequest['method'],
    body?: unknown,
    command = false,
  ) {
    await action.mutateAsync({
      path: `/api/devices/${formatEnOceanId(sourceId)}${command ? '/command' : ''}`,
      method,
      body,
      sourceId,
    });
  }

  async function pairChannel(sourceId: number) {
    setPairingRequest({ sourceId, sending: true });
    try {
      await action.mutateAsync({ path: '/api/pairing/transmit', body: { sourceId } });
      setPairingRequest({ sourceId, sending: false });
    } catch {
      setPairingRequest(null);
    }
  }

  const paired =
    pairingRequest &&
    snapshot?.devices.some((device) => deviceTransmitId(device) === pairingRequest.sourceId);
  const pairingSourceId =
    pairingRequest && !paired && (pairingRequest.sending || snapshot?.pairing.active)
      ? pairingRequest.sourceId
      : null;
  const connectionError =
    status === 'disconnected' ? 'Server connection lost. Reconnecting...' : '';

  return (
    <>
      <a
        className="skip-link"
        href="#main-content"
      >
        Skip to content
      </a>
      <div className={`app-shell ${navigationOpen ? 'navigation-open' : ''}`}>
        <Sidebar
          mqtt={snapshot?.mqtt ?? null}
          transport={snapshot?.transport ?? null}
          onNavigate={() => setNavigationOpen(false)}
        />
        <main
          className="main-content"
          id="main-content"
        >
          <TopBar
            title={findAppRoute(pathname)?.title ?? 'Page not found'}
            navigationOpen={navigationOpen}
            onToggleNavigation={() => setNavigationOpen(!navigationOpen)}
          />
          {(connectionError || error || queryError) && (
            <div
              className="error-banner"
              role="alert"
            >
              {connectionError || error || queryError?.message}
            </div>
          )}
          <div className="page-content">
            {snapshot ? (
              <AppContext
                value={{
                  ...snapshot,
                  busyTargets,
                  onCommand: (sourceId, body) => {
                    void deviceRequest(sourceId, 'POST', body, true).catch(() => undefined);
                  },
                  onDeleteDevice: (sourceId) => deviceRequest(sourceId, 'DELETE'),
                  onRenameDevice: (sourceId, name) => deviceRequest(sourceId, 'PUT', { name }),
                  onPairChannel: (sourceId) => {
                    void pairChannel(sourceId);
                  },
                  onCancelPairing: () => {
                    action.mutate({ path: '/api/pairing/stop' });
                  },
                  onAcceptCandidate: ({ targetId }, profileId) => {
                    action.mutate({
                      path: '/api/pairing/accept',
                      body: { targetId, profileId },
                      sourceId: targetId,
                    });
                  },
                  onRejectCandidate: ({ targetId }) => {
                    action.mutate({
                      path: '/api/pairing/reject',
                      body: { targetId },
                      sourceId: targetId,
                    });
                  },
                  onIgnoreCandidate: ({ targetId }) => {
                    action.mutate({
                      path: '/api/pairing/ignore',
                      body: { targetId },
                      sourceId: targetId,
                    });
                  },
                  onClearIgnoredDevice: (targetId) => {
                    action.mutate({
                      path: '/api/pairing/unignore',
                      body: { targetId },
                      sourceId: targetId,
                    });
                  },
                  pairingSourceId,
                  pairingMessage: {
                    error: false,
                    text: paired
                      ? `Device paired on ${formatEnOceanId(pairingRequest!.sourceId)}.`
                      : pairingSourceId !== null
                        ? `Pairing on ${formatEnOceanId(pairingSourceId)}...`
                        : pairingRequest
                          ? 'Pairing session ended.'
                          : '',
                  },
                }}
              >
                <Outlet />
              </AppContext>
            ) : (
              <div
                className="loading-state"
                role="status"
              >
                Connecting to EnOcean2MQTT...
              </div>
            )}
          </div>
        </main>
      </div>
    </>
  );
}
