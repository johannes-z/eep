import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { HomeAssistantSettings } from '../components/HomeAssistantSettings';
import { GeneralSettings } from '../components/GeneralSettings';
import { MqttSettings } from '../components/MqttSettings';
import { Overview } from '../components/Overview';
import { PacketListener } from '../components/PacketListener';
import { TransportSettings } from '../components/TransportSettings';
import { App, useAppContext } from '../App';
import { findAppRoute } from './routes';

function routeMetadata(path: string) {
  const metadata = findAppRoute(path);
  if (!metadata) throw new Error(`Missing route metadata for ${path}`);
  return metadata;
}

function LoadingPage() {
  return <div className="loading-state">Loading...</div>;
}

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

function TransportRoute() {
  const { onSaveTransport, onTransportChange, savingTransport, transport, transportMessage } =
    useAppContext();
  return transport ? (
    <TransportSettings
      message={transportMessage}
      onChange={onTransportChange}
      onSave={onSaveTransport}
      saving={savingTransport}
      settings={transport}
    />
  ) : (
    <LoadingPage />
  );
}

function MqttRoute() {
  const { mqtt, mqttMessage, onMqttChange, onSaveMqtt, savingMqtt } = useAppContext();
  return mqtt ? (
    <MqttSettings
      message={mqttMessage}
      onChange={onMqttChange}
      onSave={onSaveMqtt}
      saving={savingMqtt}
      settings={mqtt}
    />
  ) : (
    <LoadingPage />
  );
}

function GeneralRoute() {
  const { general, generalMessage, onGeneralChange, onSaveGeneral, savingGeneral } =
    useAppContext();
  const { onPairChannel, pairingMessage, pairingSourceId } = useAppContext();
  return general ? (
    <GeneralSettings
      message={generalMessage}
      onChange={onGeneralChange}
      onSave={onSaveGeneral}
      onPairChannel={onPairChannel}
      pairingMessage={pairingMessage}
      pairingSourceId={pairingSourceId}
      saving={savingGeneral}
      settings={general}
    />
  ) : (
    <LoadingPage />
  );
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

const rootRoute = createRootRoute({ component: App });

const overviewRoute = createRoute({
  component: OverviewRoute,
  getParentRoute: () => rootRoute,
  path: '/',
  staticData: routeMetadata('/'),
});

const packetListenerRoute = createRoute({
  component: PacketListenerRoute,
  getParentRoute: () => rootRoute,
  path: '/packet-listener',
  staticData: routeMetadata('/packet-listener'),
});

const transportRoute = createRoute({
  component: TransportRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/transport',
  staticData: routeMetadata('/settings/transport'),
});

const mqttRoute = createRoute({
  component: MqttRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/mqtt',
  staticData: routeMetadata('/settings/mqtt'),
});

const generalRoute = createRoute({
  component: GeneralRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/general',
  staticData: routeMetadata('/settings/general'),
});

const homeAssistantRoute = createRoute({
  component: HomeAssistantRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/homeassistant',
  staticData: routeMetadata('/settings/homeassistant'),
});

export const routeTree = rootRoute.addChildren([
  overviewRoute,
  packetListenerRoute,
  transportRoute,
  generalRoute,
  mqttRoute,
  homeAssistantRoute,
]);

export const router = createRouter({
  history: createBrowserHistory(),
  routeTree,
  trailingSlash: 'never',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
