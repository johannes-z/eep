import { createFileRoute } from '@tanstack/react-router';
import { MqttSettings } from '../components/MqttSettings';
import { useAppContext } from '../App';
import { routeMetadata } from '../ui/routes';

function LoadingPage() {
  return <div className="loading-state">Loading...</div>;
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

export const Route = createFileRoute('/settings/mqtt')({
  component: MqttRoute,
  staticData: routeMetadata('/settings/mqtt'),
});
