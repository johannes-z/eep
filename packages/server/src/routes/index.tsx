import { createFileRoute } from '@tanstack/react-router';
import { Overview } from '../components/Overview';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function OverviewRoute() {
  const { busyTarget, devices, onCommand, onDeleteDevice, onRenameDevice } = useAppContext();
  return (
    <Overview
      busyTarget={busyTarget}
      devices={devices}
      onCommand={onCommand}
      onDelete={onDeleteDevice}
      onRename={onRenameDevice}
    />
  );
}

export const Route = createFileRoute('/')({
  component: OverviewRoute,
  staticData: routeMetadata('/'),
});
