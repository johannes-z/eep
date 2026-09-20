import { createFileRoute } from '@tanstack/react-router';
import { MqttSettings } from '../components/MqttSettings';
import { useAppContext } from '../ui/App';
import { routeMetadata } from '../ui/routes';

function MqttRoute() {
  const { mqtt } = useAppContext();
  return <MqttSettings settings={mqtt} />;
}

export const Route = createFileRoute('/settings/mqtt')({
  component: MqttRoute,
  staticData: routeMetadata('/settings/mqtt'),
});
