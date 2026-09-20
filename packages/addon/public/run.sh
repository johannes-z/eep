#!/usr/bin/with-contenv bashio
set +u

CONFIG_PATH=/data/options.json
export MODE=addon
export DATA_DIR=/data
export WEB_ROOT=./
export HOST=0.0.0.0
export ADAPTER="$(bashio::config 'adapter')"
export ADAPTER_TYPE="$(bashio::config 'adapter_type')"
export BAUD_RATE="$(bashio::config 'baud_rate')"
export DISABLE_LED="$(bashio::config 'disable_led')"
export RTSCTS="$(bashio::config 'rtscts')"

bun run start
