import { createFileRoute } from '@tanstack/react-router';
import { TransportSettings } from '../components/TransportSettings';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function LoadingPage() {
  return <div className="loading-state">Loading...</div>;
}

function TransportRoute() {
  const { onSaveTransport, onTransportChange, savingTransport, transport, transportMessage } =
    useAppContext();
  return transport ? (
    <TransportSettings
      message={transportMessage}
      onChange={onTransportChange}
      onSave={onSaveTransport}
      saving={savingTransport}
      settings={transport}
    />
  ) : (
    <LoadingPage />
  );
}

export const Route = createFileRoute('/settings/transport')({
  component: TransportRoute,
  staticData: routeMetadata('/settings/transport'),
});
