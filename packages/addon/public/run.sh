#!/usr/bin/with-contenv bashio
set +u

CONFIG_PATH=/data/options.json
export MODE=addon
export DATA_DIR=/data
export WEB_ROOT=./
export HOST=0.0.0.0
export ADAPTER="$(bashio::config 'adapter')"

bun run start
