const server = Bun.spawn(['bun', './main.js'], {
  env: process.env,
  stderr: 'inherit',
  stdout: 'inherit',
});

process.exitCode = await server.exited;
