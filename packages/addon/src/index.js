const { initialize } = require('@eep/server')

initialize({
  adapter: process.env.ADAPTER
})

const fs = require('fs');

fs.readdir('./data', (err, files) => {
  files.forEach(file => {
    console.log(file);
  });
});
