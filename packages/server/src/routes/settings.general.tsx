import { createFileRoute } from '@tanstack/react-router';
import { GeneralSettings } from '../components/GeneralSettings';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function LoadingPage() {
  return <div className="loading-state">Loading...</div>;
}

function GeneralRoute() {
  const { general, generalMessage, onGeneralChange, onSaveGeneral, savingGeneral } =
    useAppContext();
  return general ? (
    <GeneralSettings
      message={generalMessage}
      onChange={onGeneralChange}
      onSave={onSaveGeneral}
      saving={savingGeneral}
      settings={general}
    />
  ) : (
    <LoadingPage />
  );
}

export const Route = createFileRoute('/settings/general')({
  component: GeneralRoute,
  staticData: routeMetadata('/settings/general'),
});
