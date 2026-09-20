import { createFileRoute } from '@tanstack/react-router';
import { Overview } from '../components/Overview';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function OverviewRoute() {
  const {
    busyTarget,
    candidates,
    devices,
    onAcceptCandidate,
    onCommand,
    onDeleteDevice,
    onRenameDevice,
    onPairing,
    onTransmitPairing,
    pairing,
  } = useAppContext();
  return (
    <Overview
      busyTarget={busyTarget}
      candidates={candidates}
      devices={devices}
      onAccept={onAcceptCandidate}
      onCommand={onCommand}
      onDelete={onDeleteDevice}
      onRename={onRenameDevice}
      onPairing={onPairing}
      onTransmitPairing={onTransmitPairing}
      pairing={pairing}
    />
  );
}

export const Route = createFileRoute('/')({
  component: OverviewRoute,
  staticData: routeMetadata('/'),
});
