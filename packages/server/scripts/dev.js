import { watch } from 'node:fs';
import { join } from 'node:path';

const cwd = join(import.meta.dir, '..');
let child;
let stopping = false;
let timer;
let pending = Promise.resolve();

async function restart() {
  if (child) {
    child.kill('SIGTERM');
    await child.exited;
  }
  if (stopping) return;
  child = Bun.spawn([process.execPath, 'run', 'generate-routes'], {
    cwd,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  if ((await child.exited) !== 0 || stopping) return;
  child = Bun.spawn([process.execPath, 'src/main.ts'], {
    cwd,
    env: { ...process.env, NODE_ENV: 'production' },
    stdout: 'inherit',
    stderr: 'inherit',
  });
}

const watchers = ['src', 'public'].map((directory) =>
  watch(join(cwd, directory), { recursive: true }, (_event, filename) => {
    if (!filename || filename.endsWith('routeTree.gen.ts') || stopping) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      pending = pending
        .then(restart)
        .catch((error) => console.error('Development restart failed:', error));
    }, 150);
  }),
);

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearTimeout(timer);
  for (const watcher of watchers) watcher.close();
  child?.kill('SIGTERM');
  await pending;
  await child?.exited;
  process.exit(0);
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
pending = restart();
await pending;
