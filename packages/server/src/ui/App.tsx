import { Outlet, useRouterState } from '@tanstack/react-router';
import { createContext, useContext, useState } from 'react';
import { Sidebar, TopBar } from '../components/Navigation';
import { formatEnOceanId } from '../util';
import { request } from './api';
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
  onAcceptCandidate: (candidate: TeachInCandidate) => void;
  onRejectCandidate: (candidate: TeachInCandidate) => void;
  onListen: () => void;
  pairingSourceId: number | null;
  pairingMessage: { text: string; error: boolean };
}

const AppContext = createContext<AppContextValue | null>(null);

export function useAppContext() {
  const context = useContext(AppContext);
  if (!context) throw new Error('App context is unavailable');
  return context;
}

export function App() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { snapshot, status } = useLiveSnapshot();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const [error, setError] = useState('');
  const [busyTargets, setBusyTargets] = useState<ReadonlySet<number>>(() => new Set());
  const [pairingRequest, setPairingRequest] = useState<{
    sourceId: number;
    sending: boolean;
  } | null>(null);

  async function execute(path: string, method = 'POST', body?: unknown) {
    setError('');
    try {
      await request(path, method, body);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Request failed');
      throw reason;
    }
  }

  async function deviceRequest(sourceId: number, method: string, body?: unknown, command = false) {
    setBusyTargets((current) => new Set(current).add(sourceId));
    try {
      await execute(
        `/api/devices/${formatEnOceanId(sourceId)}${command ? '/command' : ''}`,
        method,
        body,
      );
    } finally {
      setBusyTargets((current) => {
        const next = new Set(current);
        next.delete(sourceId);
        return next;
      });
    }
  }

  async function pairChannel(sourceId: number) {
    setPairingRequest({ sourceId, sending: true });
    try {
      await execute('/api/pairing/transmit', 'POST', { sourceId });
      setPairingRequest({ sourceId, sending: false });
    } catch {
      setPairingRequest(null);
    }
  }

  const paired =
    pairingRequest &&
    snapshot?.devices.some((device) => device.sourceId === pairingRequest.sourceId);
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
            connectionStatus={status}
            navigationOpen={navigationOpen}
            onToggleNavigation={() => setNavigationOpen(!navigationOpen)}
          />
          {(connectionError || error) && (
            <div
              className="error-banner"
              role="alert"
            >
              {connectionError || error}
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
                    void execute('/api/pairing/stop').catch(() => undefined);
                  },
                  onAcceptCandidate: ({ targetId }) => {
                    void execute('/api/pairing/accept', 'POST', { targetId }).catch(
                      () => undefined,
                    );
                  },
                  onRejectCandidate: ({ targetId }) => {
                    void execute('/api/pairing/reject', 'POST', { targetId }).catch(
                      () => undefined,
                    );
                  },
                  onListen: () => {
                    void execute(`/api/listen/${snapshot.listen.active ? 'stop' : 'start'}`).catch(
                      () => undefined,
                    );
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
