import { expect, test } from 'bun:test';
import { appRoutes, findAppRoute } from './routes';

test('defines canonical routes for every app view', () => {
  expect(appRoutes.map((route) => route.path)).toEqual([
    '/devices',
    '/pairing',
    '/packet-listener',
    '/settings/transport',
    '/settings/mqtt',
    '/settings/homeassistant',
  ]);
  expect(appRoutes.map((route) => route.view)).toEqual([
    'devices',
    'pairing',
    'packet-listener',
    'settings',
    'mqtt',
    'homeassistant',
  ]);
});

test('resolves routes and normalizes trailing slashes', () => {
  expect(findAppRoute('/settings/mqtt/')).toMatchObject({ view: 'mqtt', title: 'MQTT' });
  expect(findAppRoute('/missing')).toBeUndefined();
  expect(findAppRoute('/settings/general')).toBeUndefined();
});
