import type { AppView } from './types';

export interface AppRoute {
  readonly path: string;
  readonly view: AppView;
  readonly title: string;
  readonly label: string;
  readonly icon: string;
  readonly section: 'general' | 'settings';
}

export const appRoutes = [
  {
    path: '/',
    view: 'overview',
    title: 'Devices',
    label: 'Devices',
    icon: '⌂',
    section: 'general',
  },
  {
    path: '/packet-listener',
    view: 'packet-listener',
    title: 'Packet listener',
    label: 'Packet listener',
    icon: '◉',
    section: 'general',
  },
  {
    path: '/settings/transport',
    view: 'settings',
    title: 'Transport',
    label: 'Transport',
    icon: '◫',
    section: 'settings',
  },
  {
    path: '/settings/general',
    view: 'general',
    title: 'General',
    label: 'General',
    icon: '⚙',
    section: 'settings',
  },
  {
    path: '/settings/mqtt',
    view: 'mqtt',
    title: 'MQTT',
    label: 'MQTT',
    icon: '◌',
    section: 'settings',
  },
  {
    path: '/settings/homeassistant',
    view: 'homeassistant',
    title: 'Home Assistant',
    label: 'Home Assistant',
    icon: '⌘',
    section: 'settings',
  },
] as const satisfies readonly AppRoute[];

export const defaultRoute = appRoutes[0];

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

export function getAppRoute(pathname: string): AppRoute {
  return findAppRoute(pathname) ?? defaultRoute;
}
