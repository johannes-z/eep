import { createFileRoute } from '@tanstack/react-router';
import { Devices } from '../components/Devices';
import { routeMetadata } from '../ui/routes';

export const Route = createFileRoute('/devices')({
  component: Devices,
  staticData: routeMetadata('/devices'),
});
