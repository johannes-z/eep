import { createFileRoute } from '@tanstack/react-router';
import { HomeAssistantSettings } from '../components/HomeAssistantSettings';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function LoadingPage() {
  return <div className="loading-state">Loading...</div>;
}

function HomeAssistantRoute() {
  const {
    homeAssistant,
    homeAssistantMessage,
    onHomeAssistantChange,
    onSaveHomeAssistant,
    savingHomeAssistant,
  } = useAppContext();
  return homeAssistant ? (
    <HomeAssistantSettings
      message={homeAssistantMessage}
      onChange={onHomeAssistantChange}
      onSave={onSaveHomeAssistant}
      saving={savingHomeAssistant}
      settings={homeAssistant}
    />
  ) : (
    <LoadingPage />
  );
}

export const Route = createFileRoute('/settings/homeassistant')({
  component: HomeAssistantRoute,
  staticData: routeMetadata('/settings/homeassistant'),
});
