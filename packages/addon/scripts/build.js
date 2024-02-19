const { build } = require('esbuild');
const fs = require('fs');

const pkg = require('../package.json');

;(async () => {
  fs.cp('./public', './dist/', { recursive: true }, (err) => {
    console.error(err)
  })
  fs.cp('./package.json', './dist/package.json', { recursive: true }, (err) => {
    console.error(err)
  })

  await build({
    entryPoints: ['./src/index.js'],
    outfile: './dist/index.js',
    bundle: true,
    platform: 'node',
    external: [
      '../node_modules/*',
      './options',
    ],
    format: 'cjs',
  });
})();
