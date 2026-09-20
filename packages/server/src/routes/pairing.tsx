import { createFileRoute } from '@tanstack/react-router';
import { useAppContext } from '../ui/App';
import { Pairing } from '../components/Pairing';
import { routeMetadata } from '../ui/routes';

function PairingRoute() {
  const app = useAppContext();
  return (
    <Pairing
      general={app.general}
      connected={app.transport.connected}
      active={app.pairing.active}
      candidates={app.pairing.candidates}
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
