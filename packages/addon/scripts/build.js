import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const packageDirectory = join(import.meta.dir, '..');
const serverDirectory = join(packageDirectory, '..', 'server');
const distDirectory = join(packageDirectory, 'dist');

const serverBuild = Bun.spawn([process.execPath, 'run', 'build'], {
  cwd: serverDirectory,
  stderr: 'inherit',
  stdout: 'inherit',
});
if ((await serverBuild.exited) !== 0) {
  throw new Error('The server build failed; add-on artifacts were not generated');
}

rmSync(distDirectory, { recursive: true, force: true });
mkdirSync(distDirectory, { recursive: true });
cpSync(join(packageDirectory, 'public'), distDirectory, { recursive: true, force: true });
cpSync(join(serverDirectory, 'dist'), distDirectory, {
  recursive: true,
  force: true,
});
cpSync(join(serverDirectory, 'public', 'index.html'), join(distDirectory, 'index.html'), {
  force: true,
});
const packageJson = JSON.parse(await Bun.file(join(packageDirectory, 'package.json')).text());
packageJson.scripts = { start: 'bun index.js' };
packageJson.main = 'index.js';
await Bun.write(join(distDirectory, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
const addonConfig = Bun.YAML.parse(await Bun.file(join(distDirectory, 'config.yaml')).text());
addonConfig.version = packageJson.version;
await Bun.write(join(distDirectory, 'config.yaml'), Bun.YAML.stringify(addonConfig));

const rootLock = Bun.JSON5.parse(
  await Bun.file(join(packageDirectory, '..', '..', 'bun.lock')).text(),
);
const addonPackages = {};
const pendingPackages = Object.keys(packageJson.dependencies ?? {});
while (pendingPackages.length) {
  const packageName = pendingPackages.pop();
  if (!packageName || addonPackages[packageName]) continue;
  const packageEntry = rootLock.packages?.[packageName];
  if (!packageEntry) throw new Error(`Missing lock entry for add-on dependency: ${packageName}`);
  addonPackages[packageName] = packageEntry;
  const dependencies = packageEntry[2]?.dependencies ?? {};
  pendingPackages.push(...Object.keys(dependencies));
}
await Bun.write(
  join(distDirectory, 'bun.lock'),
  `${JSON.stringify(
    {
      lockfileVersion: rootLock.lockfileVersion,
      configVersion: rootLock.configVersion,
      workspaces: {
        '': {
          name: packageJson.name,
          version: packageJson.version,
          dependencies: packageJson.dependencies,
        },
      },
      packages: addonPackages,
    },
    null,
    2,
  )}\n`,
);
