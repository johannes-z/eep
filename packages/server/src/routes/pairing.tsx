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
      ignoredDevices={app.pairing.ignoredDevices}
      busyTargets={app.busyTargets}
      message={app.pairingMessage}
      sourceId={app.pairingSourceId}
      onPair={app.onPairChannel}
      onCancel={app.onCancelPairing}
      onAccept={app.onAcceptCandidate}
      onReject={app.onRejectCandidate}
      onIgnore={app.onIgnoreCandidate}
      onClearIgnored={app.onClearIgnoredDevice}
    />
  );
}

export const Route = createFileRoute('/pairing')({
  component: PairingRoute,
  staticData: routeMetadata('/pairing'),
});
