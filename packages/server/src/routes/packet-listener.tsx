import { createFileRoute } from '@tanstack/react-router';
import { PacketListener } from '../components/PacketListener';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function LoadingPage() {
  return <div className="loading-state">Loading...</div>;
}

function PacketListenerRoute() {
  const { listen, onListen } = useAppContext();
  return listen ? (
    <PacketListener
      listen={listen}
      onListen={onListen}
    />
  ) : (
    <LoadingPage />
  );
}

export const Route = createFileRoute('/packet-listener')({
  component: PacketListenerRoute,
  staticData: routeMetadata('/packet-listener'),
});
