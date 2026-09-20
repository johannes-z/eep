import { createFileRoute } from '@tanstack/react-router';
import { TransportSettings } from '../components/TransportSettings';
import { useAppContext } from '../ui/App';
import { routeMetadata } from '../ui/routes';

function TransportRoute() {
  const { transport, general } = useAppContext();
  return (
    <TransportSettings
      settings={transport}
      general={general}
    />
  );
}

export const Route = createFileRoute('/settings/transport')({
  component: TransportRoute,
  staticData: routeMetadata('/settings/transport'),
});
