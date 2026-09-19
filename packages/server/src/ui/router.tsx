import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { HomeAssistantSettings } from '../components/HomeAssistantSettings';
import { MqttSettings } from '../components/MqttSettings';
import { Overview } from '../components/Overview';
import { PacketListener } from '../components/PacketListener';
import { TransportSettings } from '../components/TransportSettings';
import { App, useAppContext } from '../App';
import { appRoutes } from './routes';

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
  staticData: appRoutes[0],
});

const packetListenerRoute = createRoute({
  component: PacketListenerRoute,
  getParentRoute: () => rootRoute,
  path: '/packet-listener',
  staticData: appRoutes[1],
});

const transportRoute = createRoute({
  component: TransportRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/transport',
  staticData: appRoutes[2],
});

const mqttRoute = createRoute({
  component: MqttRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/mqtt',
  staticData: appRoutes[3],
});

const homeAssistantRoute = createRoute({
  component: HomeAssistantRoute,
  getParentRoute: () => rootRoute,
  path: '/settings/homeassistant',
  staticData: appRoutes[4],
});

export const routeTree = rootRoute.addChildren([
  overviewRoute,
  packetListenerRoute,
  transportRoute,
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
