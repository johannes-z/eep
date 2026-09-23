import { createFileRoute } from '@tanstack/react-router';
import { PacketListener } from '../components/PacketListener';
import { useAppContext } from '../ui/App';
import { routeMetadata } from '../ui/routes';

function PacketListenerRoute() {
  const { devices, listen } = useAppContext();
  return (
    <PacketListener
      devices={devices}
      listen={listen}
    />
  );
}

export const Route = createFileRoute('/packet-listener')({
  component: PacketListenerRoute,
  staticData: routeMetadata('/packet-listener'),
});
