# EEP server

The server is deployment-independent. It can run directly with Bun, in Docker, or as a thin Home Assistant add-on wrapper.

## Standalone

```sh
bun install
bun run build
bun run start
```

The web UI listens on `127.0.0.1:3000` by default. Set `HOST=0.0.0.0` when the service should be reachable from another host.
The HTTP API has no built-in authentication; keep it on a trusted network or place it behind an authenticated reverse proxy before exposing it remotely.

## Runtime settings

- `HOST`, `PORT`: HTTP bind address and port.
- `DATA_DIR`: writable directory for device and integration state.
- `ADAPTER`, `ADAPTER_PATH`: legacy or explicit serial/TCP adapter path.
- `ADAPTER_TYPE`: `none`, `serial`, or `tcp`.
- `BAUD_RATE`, `RTSCTS`: serial adapter settings.
- `ADAPTER_NAME`, `DISABLE_LED`: accepted only for legacy configuration compatibility; they are not used by `bun-serialport`.
- `CONTROLLER_ID`: optional EnOcean controller ID.
- `MQTT_URL` or `MQTT_HOST`/`MQTT_PORT`: broker connection.
- `MQTT_USERNAME`, `MQTT_PASSWORD`: broker credentials.
- `HA_ENABLED`, `HA_DISCOVERY_TOPIC`, `HA_STATUS_TOPIC`: Home Assistant discovery settings.

The same values can be reviewed and updated from the web UI. Transport changes are persisted and applied by replacing the active connection; a failed replacement leaves the last known-good connection active.

## Device capabilities

Each device in `DATA_DIR/states.json` can restrict the functions exposed by its protocol. For a `D2-50-00` vent, configure the `supportedFunctions` array with IDs from the protocol matrix, for example:

```json
"supportedFunctions": [
	"off",
	"level1",
	"level2",
	"level3",
	"automatic",
	"supplyOnly",
	"exhaustOnly"
]
```

Omit `level4` or `automaticOnDemand` when the device does not support them. Home Assistant discovery, web controls, command validation, and percentage-to-speed mapping all use this list. Existing `supportedPresets` state is migrated when it is loaded.

## Docker

Build with `packages/server` as the Docker context:

```sh
docker build -t eep-server packages/server
docker run --rm -p 3000:3000 -v eep-data:/data eep-server
```

Use a secret store or environment injection for MQTT credentials. Do not commit passwords to `data/settings.json`.
