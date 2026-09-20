import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const targets = [
  ['linux-x64', 'bun-linux-x64', 'eep-server-linux-x64'],
  ['linux-arm64', 'bun-linux-arm64', 'eep-server-linux-arm64'],
  ['darwin-x64', 'bun-darwin-x64', 'eep-server-darwin-x64'],
  ['darwin-arm64', 'bun-darwin-arm64', 'eep-server-darwin-arm64'],
  ['windows-x64', 'bun-windows-x64', 'eep-server-windows-x64.exe'],
];

const serverDirectory = join(import.meta.dir, '..');
const releaseDirectory = join(serverDirectory, 'release');
const requestedTargets = process.argv.slice(2);
for (const target of requestedTargets) {
  if (!targets.some(([name]) => name === target)) {
    throw new Error(`Unknown release target: ${target}`);
  }
}
const selectedTargets = requestedTargets.length
  ? targets.filter(([name]) => requestedTargets.includes(name))
  : targets;

if (!requestedTargets.length) rmSync(releaseDirectory, { recursive: true, force: true });
mkdirSync(releaseDirectory, { recursive: true });

for (const [name, target, executable] of selectedTargets) {
  const output = join(releaseDirectory, executable);
  const result = Bun.spawnSync(
    [
      process.execPath,
      'build',
      './src/main.ts',
      '--compile',
      `--target=${target}`,
      ...(name.startsWith('windows-') ? ['--external', 'bun-serialport'] : []),
      '--outfile',
      output,
    ],
    { cwd: serverDirectory, stderr: 'inherit', stdout: 'inherit' },
  );

  if (!result.success) throw new Error(`Failed to build ${name} release binary`);
  console.log(`Built ${name}: ${output}`);
}
