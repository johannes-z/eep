import { createFileRoute } from '@tanstack/react-router';
import { useAppContext } from '../App';
import { Pairing } from '../components/Pairing';
import { routeMetadata } from '../ui/routes';

function PairingRoute() {
  const app = useAppContext();
  if (!app.general || !app.transport)
    return (
      <div
        className="loading-state"
        role="status"
      >
        Loading pairing...
      </div>
    );
  return (
    <Pairing
      general={app.general}
      connected={app.transport.connected}
      active={app.pairing}
      candidates={app.candidates}
      message={app.pairingMessage}
      sourceId={app.pairingSourceId}
      onPair={app.onPairChannel}
      onCancel={app.onCancelPairing}
      onAccept={app.onAcceptCandidate}
      onReject={app.onRejectCandidate}
    />
  );
}

export const Route = createFileRoute('/pairing')({
  component: PairingRoute,
  staticData: routeMetadata('/pairing'),
});
