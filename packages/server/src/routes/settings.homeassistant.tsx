import { createFileRoute } from '@tanstack/react-router';
import { HomeAssistantSettings } from '../components/HomeAssistantSettings';
import { useAppContext } from '../ui/App';
import { routeMetadata } from '../ui/routes';

function HomeAssistantRoute() {
  const { homeAssistant } = useAppContext();
  return <HomeAssistantSettings settings={homeAssistant} />;
}

export const Route = createFileRoute('/settings/homeassistant')({
  component: HomeAssistantRoute,
  staticData: routeMetadata('/settings/homeassistant'),
});
