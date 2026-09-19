import { initialize } from './index';

if (import.meta.dir.endsWith('/dist') || import.meta.dir.endsWith('\\dist')) {
  process.chdir(import.meta.dir);
}

initialize().catch((error: unknown) => {
  console.error('Server startup failed:', error);
  process.exitCode = 1;
});
