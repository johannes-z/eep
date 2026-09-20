import { join } from 'node:path';

const server = Bun.spawn([process.execPath, join(import.meta.dir, 'main.js')], {
  env: process.env,
  stderr: 'inherit',
  stdout: 'inherit',
});

process.once('SIGINT', () => server.kill('SIGINT'));
process.once('SIGTERM', () => server.kill('SIGTERM'));

process.exitCode = await server.exited;
