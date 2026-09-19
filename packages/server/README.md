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
- `DATA_DIR`: writable directory containing `configuration.yaml` and the SQLite `state.db` runtime store.
- `ADAPTER`, `ADAPTER_PATH`: legacy or explicit serial/TCP adapter path.
- `ADAPTER_TYPE`: `none`, `serial`, or `tcp`.
- `BAUD_RATE`, `RTSCTS`: serial adapter settings.
- `ADAPTER_NAME`, `DISABLE_LED`: accepted only for legacy configuration compatibility; they are not used by `bun-serialport`.
- `CONTROLLER_ID`: optional EnOcean controller ID.
- `MQTT_URL` or `MQTT_HOST`/`MQTT_PORT`: broker connection.
- `MQTT_USERNAME`, `MQTT_PASSWORD`: broker credentials.
- `HA_ENABLED`, `HA_DISCOVERY_TOPIC`, `HA_STATUS_TOPIC`: Home Assistant discovery settings.

Keep the MQTT credentials in the ignored `DATA_DIR/secrets.yaml` file and reference them from
`configuration.yaml` with `!secret` tags:

```yaml
# secrets.yaml
mqtt_username: replace-me
mqtt_password: replace-me
```

```yaml
# configuration.yaml
mqtt:
	username: !secret mqtt_username
	password: !secret mqtt_password
```

The same values can be reviewed and updated from the web UI. Transport changes are persisted and applied by replacing the active connection; a failed replacement leaves the last known-good connection active.

## Device capabilities

Each paired device is stored in `DATA_DIR/configuration.yaml` under its `sourceId`. Device entries contain the friendly `name` and protocol configuration. Availability, last-seen time, and reported or desired state are runtime values persisted in `DATA_DIR/state.db`, not YAML. For a `D2-50-00` vent, configure the `capabilities` array with IDs from the protocol matrix, for example:

```yaml
devices:
	ffe76681:
		targetId: '0513cefe'
		name: Living Room vent
		profileId: D2-50-00
		capabilities:
			- off
			- level1
			- level2
			- level3
			- automatic
			- supplyOnly
			- exhaustOnly
```

Omit `level4` or `automaticOnDemand` when the device does not support them. Home Assistant discovery, web controls, command validation, and percentage-to-speed mapping all use this list. Existing `states.json`, `devices.json`, and `settings.json` files are read when no `configuration.yaml` exists; configuration is migrated to YAML and legacy runtime state is migrated to SQLite.

## Permit join and UTE

Permit join is available from the web console and, when MQTT/Home Assistant is enabled, as the
discovered `Permit join` switch with the `mdi:access-point-network` icon. The bridge also exposes a
`Restart` button with the `mdi:restart` icon. Both controls are attached to the bridge device.

Automatic joining uses the EEP Universal Teach-In (UTE) D4 telegram format. The server accepts
valid UTE teach-in queries for profiles present in its profile registry and acknowledges
bidirectional requests immediately. Unsupported EEPs receive the UTE `EEP not supported`
response; teach-out, malformed, and reserved requests are not added as candidates. Adding a
candidate in the web console stores its metadata and enables normal profile-based operation.

For receiver-driven devices such as the AEROline vent, select a receiver channel and activate its
local learn mode first. Then open Permit join and use `Send controller signal` in the web console,
or turn the Home Assistant switch `ON`, while the receiver's 30-second learning window is open.
The server broadcasts a D4 UTE query using the configured controller ID; an accepted response
identifies the vent and creates the pending candidate.

UTE responses require a non-zero controller ID. Set `CONTROLLER_ID`, or keep at least one device
with a valid persisted `sourceId`, before using Permit join.

## Docker

Build with `packages/server` as the Docker context:

```sh
docker build -t eep-server packages/server
docker run --rm -p 3000:3000 -v eep-data:/data eep-server
```

Use a secret store or environment injection for MQTT credentials. Do not commit `secrets.yaml` or passwords to `data/configuration.yaml`.
