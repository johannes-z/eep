import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const packageDirectory = join(import.meta.dir, '..');
const distDirectory = join(packageDirectory, 'dist');
rmSync(distDirectory, { recursive: true, force: true });
mkdirSync(distDirectory, { recursive: true });
cpSync(join(packageDirectory, 'public'), distDirectory, { recursive: true, force: true });
cpSync(join(packageDirectory, '..', 'server', 'dist'), distDirectory, {
  recursive: true,
  force: true,
});
cpSync(
  join(packageDirectory, '..', 'server', 'public', 'index.html'),
  join(distDirectory, 'index.html'),
  {
    force: true,
  },
);
const packageJson = JSON.parse(await Bun.file(join(packageDirectory, 'package.json')).text());
packageJson.scripts = { start: 'bun index.js' };
await Bun.write(join(distDirectory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
