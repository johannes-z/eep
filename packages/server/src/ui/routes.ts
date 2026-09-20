import type { AppView } from './types';

export interface AppRoute {
  readonly path: string;
  readonly view: AppView;
  readonly title: string;
  readonly label: string;
  readonly section: 'general' | 'settings';
}

export const appRoutes = [
  {
    path: '/devices',
    view: 'devices',
    title: 'Devices',
    label: 'Devices',
    section: 'general',
  },
  {
    path: '/pairing',
    view: 'pairing',
    title: 'Pairing',
    label: 'Pairing',
    section: 'general',
  },
  {
    path: '/packet-listener',
    view: 'packet-listener',
    title: 'Packet listener',
    label: 'Packet listener',
    section: 'general',
  },
  {
    path: '/settings/transport',
    view: 'settings',
    title: 'Transport & dongle',
    label: 'Transport & dongle',
    section: 'settings',
  },
  {
    path: '/settings/mqtt',
    view: 'mqtt',
    title: 'MQTT',
    label: 'MQTT',
    section: 'settings',
  },
  {
    path: '/settings/homeassistant',
    view: 'homeassistant',
    title: 'Home Assistant',
    label: 'Home Assistant',
    section: 'settings',
  },
] as const satisfies readonly AppRoute[];

function normalizePathname(pathname: string): string {
  const normalized = pathname.replace(/\/+$/, '');
  return normalized || '/';
}

export function findAppRoute(pathname: string): AppRoute | undefined {
  const normalized = normalizePathname(pathname);
  return appRoutes.find((route) => route.path === normalized);
}

export function routeMetadata(pathname: string): AppRoute {
  const metadata = findAppRoute(pathname);
  if (!metadata) throw new Error(`Missing route metadata for ${pathname}`);
  return metadata;
}
