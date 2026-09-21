import { expect, test } from 'bun:test';
import { createApplicationLifecycle } from './lifecycle';

test('restarts the application only after cleaning up the previous runtime', async () => {
  const events: string[] = [];
  let requestRestart: (() => Promise<void>) | undefined;
  const lifecycle = createApplicationLifecycle(async (restart) => {
    requestRestart = restart;
    events.push('start');
    return async () => {
      events.push('stop');
    };
  });

  await lifecycle.restart();
  await requestRestart!();
  expect(events).toEqual(['start', 'stop', 'start']);
  await lifecycle.stop();
  expect(events).toEqual(['start', 'stop', 'start', 'stop']);
});

test('coalesces simultaneous restart requests', async () => {
  let starts = 0;
  let stops = 0;
  const lifecycle = createApplicationLifecycle(async () => {
    starts += 1;
    return async () => {
      stops += 1;
    };
  });

  await lifecycle.restart();
  await Promise.all([lifecycle.restart(), lifecycle.restart(), lifecycle.restart()]);
  expect(starts).toBe(2);
  expect(stops).toBe(1);
  await lifecycle.stop();
});

test('shutdown cancels a queued restart and prevents subsequent restarts', async () => {
  let starts = 0;
  let stops = 0;
  const lifecycle = createApplicationLifecycle(async () => {
    starts += 1;
    return async () => {
      stops += 1;
    };
  });

  await lifecycle.restart();
  await Promise.all([lifecycle.restart(), lifecycle.stop(), lifecycle.stop()]);
  await lifecycle.restart();
  expect(starts).toBe(1);
  expect(stops).toBe(1);
});

test('shutdown waits for startup and cleans up the new runtime', async () => {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  let stops = 0;
  const lifecycle = createApplicationLifecycle(async () => {
    started.resolve();
    await release.promise;
    return async () => {
      stops += 1;
    };
  });

  const startup = lifecycle.restart();
  await started.promise;
  const shutdown = lifecycle.stop();
  release.resolve();
  await Promise.all([startup, shutdown]);
  expect(stops).toBe(1);
});

test('can retry startup after a failed restart', async () => {
  let starts = 0;
  let stops = 0;
  const lifecycle = createApplicationLifecycle(async () => {
    starts += 1;
    if (starts === 2) throw new Error('Startup failed');
    return async () => {
      stops += 1;
    };
  });

  await lifecycle.restart();
  const failure = await lifecycle.restart().catch((error: unknown) => error);
  expect(failure).toEqual(new Error('Startup failed'));
  await lifecycle.restart();
  expect(starts).toBe(3);
  expect(stops).toBe(1);
  await lifecycle.stop();
  expect(stops).toBe(2);
});
