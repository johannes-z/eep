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

The web UI receives live state snapshots over `/api/events` using WebSocket, with automatic
reconnection and resynchronization instead of polling. Commands and settings saves use HTTP.
Reverse proxies must forward WebSocket upgrades and preserve the original Host and scheme
so the WebSocket endpoint can validate the browser's Origin. Protect this endpoint with the
same authentication as the HTTP API.

## Standalone releases

Tagged releases publish standalone binaries for Windows x64, Linux x64 and arm64, and macOS x64 and arm64.
Download the binary for the server platform, make it executable on Unix-like systems, and run it with `DATA_DIR` set to a writable directory:

```sh
DATA_DIR=/var/lib/eep ./eep-server-linux-x64
```

The Windows binary supports TCP transports and `TRANSPORT_TYPE=none`. The bundled serial transport uses POSIX APIs and is supported on Linux and macOS; use a TCP serial bridge on Windows.

## Runtime settings

- `HOST`, `PORT`: HTTP bind address and port.
- `DATA_DIR`: writable directory containing `configuration.yaml` and the SQLite `state.db` runtime store.
- `TRANSPORT_PATH`: serial device path or `tcp://host:port` endpoint.
- `TRANSPORT_TYPE`: `none`, `serial`, or `tcp`.
- `BAUD_RATE`, `RTSCTS`: serial transport settings.
- `CONTROLLER_ID`: optional EnOcean controller ID.
- `START_ID`: optional first sender ID for automatic UTE allocation. The web UI also stores this as `general.startId` in `configuration.yaml`.
- `MQTT_URL` or `MQTT_HOST`/`MQTT_PORT`: broker connection.
- `MQTT_USERNAME`, `MQTT_PASSWORD`: broker credentials.
- `HA_ENABLED`, `HA_DISCOVERY_TOPIC`, `HA_STATUS_TOPIC`, `HA_LOG_LEVEL`: Home Assistant discovery settings.

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

An unavailable transceiver no longer prevents the management server from starting. TCP connection
attempts time out after five seconds. Lost connections retry in the background with exponential
backoff from one to thirty seconds, and connection changes are pushed to the UI. Disabled or
disconnected transports reject commands rather than silently accepting them. Transceiver base IDs
and available channels are refreshed after connection recovery or replacement.

Saving unrelated settings leaves unchanged MQTT secrets untouched, including the existing secrets
file's comments and formatting.

## Application boundaries

- `index.ts` composes the registry, transport, teach-in, MQTT, HTTP, and live-state services.
- `devices/registry.ts` owns normalized device state and notifies integrations of changes.
- `devices/commands.ts` is the shared command path for HTTP and MQTT. Encoding and decoding stay in `profiles/`.
- `transport/runtime.ts` owns connection replacement, recovery, packet reception, and connectivity events. Adapters handle serial/TCP I/O.
- `app/requestHandler.ts` validates HTTP input and projects backend state. `app/stateUpdates.ts` broadcasts snapshots.
- `ui/useLiveSnapshot.ts` owns browser WebSocket connection and reconnection. Forms preserve unsaved drafts across snapshots; device state is never a separate frontend authority.
- `components/` renders the management interface. The UI uses locally bundled fonts and icons, with no external asset service required.

The console includes device search and availability filters, device details and state inspection,
dedicated pairing, RX/TX packet filters and JSON export, and configuration forms. Navigation and
device rows adapt to narrow screens; the live indicator reflects receipt of a server snapshot.

## Development

From the repository root:

```sh
bun install
bun run dev
bun test packages/server/src
bun run typecheck
bun run lint
bun run --cwd packages/server build
```

For UI-only development, use a temporary `DATA_DIR` and `TRANSPORT_TYPE=none`. Keep that directory
separate from a running installation's configuration and SQLite state. A real serial transceiver
or TCP bridge is required to verify radio communication; unit tests use simulated connections.

The development runner watches `src/` and `public/`, regenerates routes, and restarts the server
after edits. Refresh the browser to load frontend changes. It intentionally uses production-mode
frontend bundling because the current TanStack Router/Bun combination fails in router HMR setup.

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

Omit `level4` or `automaticOnDemand` when the device does not support them. Home Assistant discovery, web controls, command validation, and percentage-to-speed mapping all use this list. Runtime state is stored in SQLite and is independent of the user-editable YAML configuration.

## Pairing and UTE

Web-console pairing starts with `Pair` on a specific sender-channel row. There is no global
permit-join control in the web UI; `Cancel pairing` is available while a session is active.
When MQTT/Home Assistant is enabled, the integration exposes the discovered `Permit join`
switch with the `mdi:access-point-network` icon. The bridge also exposes a
`Restart` button with the `mdi:restart` icon. Both controls are attached to the bridge device.

Automatic joining uses the EEP Universal Teach-In (UTE) D4 telegram format. The server accepts
valid UTE teach-in queries for profiles present in its profile registry and acknowledges
bidirectional requests immediately. Unsupported EEPs receive the UTE `EEP not supported`
response; teach-out, malformed, and reserved requests are not added as candidates. Adding a
candidate in the web console stores its metadata and enables normal profile-based operation.

For receiver-driven devices such as the AEROline vent, activate its local learn mode, then select
a free sender channel on the Pairing page and choose `Pair` in its row while the receiver's learning
window is open. Alternatively, use the Home Assistant permit-join switch.
The server broadcasts a D4 UTE query using the first free sender ID at or above `startId`; an
explicit channel selection takes precedence. Targeted responses are accepted and persisted
automatically; untargeted candidates can be added or dismissed on the Pairing page. Pairing expires
after sixty seconds. Stopping or expiring a session clears pending candidates and channel targeting;
a failed transmission closes the session. The USB 300 base ID is
read from the transport and shown read-only in General settings. It is not used as the last-used
allocation cursor and is not persisted in `configuration.yaml`.

UTE responses require a non-zero controller ID. Set `CONTROLLER_ID`, or keep at least one device
with a valid persisted `sourceId`, before using Permit join.

## Docker

Build from the repository root so the image uses the workspace lockfile:

```sh
docker build -f packages/server/Dockerfile -t eep-server .
docker run --rm -p 3000:3000 -v eep-data:/data eep-server
```

Use a secret store or environment injection for MQTT credentials. Do not commit `secrets.yaml` or passwords to `data/configuration.yaml`.
