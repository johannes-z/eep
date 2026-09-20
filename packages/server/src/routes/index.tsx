import { createFileRoute } from '@tanstack/react-router';
import { Overview } from '../components/Overview';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function OverviewRoute() {
  const { busyTarget, devices, general, transport, onCommand, onDeleteDevice, onRenameDevice } =
    useAppContext();
  if (!general)
    return (
      <div
        className="loading-state"
        role="status"
      >
        Loading devices...
      </div>
    );
  return (
    <Overview
      commandsAvailable={Boolean(transport?.connected)}
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
