#!/usr/bin/with-contenv bashio
set +u

CONFIG_PATH=/data/options.json
export ADAPTER="$(bashio::config 'adapter')"

npm run start
