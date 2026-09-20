#!/usr/bin/with-contenv bashio
set +u

export MODE=addon
export DATA_DIR=/data
export WEB_ROOT=./
export HOST=0.0.0.0
export TRANSPORT_TYPE="$(bashio::config 'transport_type')"
export TRANSPORT_PATH="$(bashio::config 'transport_path')"
export BAUD_RATE="$(bashio::config 'baud_rate')"
export RTSCTS="$(bashio::config 'rtscts')"

bun run start
