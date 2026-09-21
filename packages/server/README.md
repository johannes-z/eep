# EEP server

The server is deployment-independent. It can run directly with Bun, in Docker, or as a thin Home Assistant add-on wrapper.

## Standalone

From the repository root:

```sh
bun install --frozen-lockfile
bun run --cwd packages/server build
bun run --cwd packages/server start
```

The web UI listens on `127.0.0.1:3000` by default. Set `HOST=0.0.0.0` when the service should be reachable from another host.
The HTTP API has no built-in authentication; keep it on a trusted network or place it behind an authenticated reverse proxy before exposing it remotely.

The web UI receives live state snapshots over `/api/events` using WebSocket, with automatic
reconnection and resynchronization instead of polling. Commands and settings saves use HTTP.
Reverse proxies must forward WebSocket upgrades and preserve the original Host and scheme
so WebSocket and state-changing HTTP requests can validate the browser's Origin. Protect these endpoints with the
same authentication as the HTTP API.

## Standalone releases

Tagged releases publish standalone binaries for Windows x64, Linux x64 and arm64, and macOS x64 and arm64.
Download the binary for the server platform, make it executable on Unix-like systems, and run it with `DATA_DIR` set to a writable directory:

```sh
DATA_DIR=/var/lib/eep ./eep-server-linux-x64
```

The Windows binary supports TCP transports and `TRANSPORT_TYPE=none`. The bundled serial transport uses POSIX APIs and is supported on Linux and macOS; use a TCP serial bridge on Windows.

Build all release targets with `bun run build:release`, or select targets such as
`bun run build:release windows-x64 linux-arm64`. Targeted builds preserve the other release outputs.

## Runtime settings

- `HOST`, `PORT`: HTTP bind address and port.
- `DATA_DIR`: writable directory containing `configuration.yaml` and the SQLite `state.db` runtime store.
- `TRANSPORT_PATH`: serial device path or `tcp://host:port` endpoint.
- `TRANSPORT_TYPE`: `none`, `serial`, or `tcp`.
- `BAUD_RATE`, `RTSCTS`: serial transport settings.
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

The transport page also displays the dongle's application description, application firmware
version, API version, chip ID, and chip version. These read-only values are queried using ESP3
`CO_RD_VERSION` over either serial or TCP at startup and after reconnection or replacement.
Unavailable or unsupported information is shown as `Unavailable`; version-query failures do
not disable the transport. Hardware details are cleared when the connection is lost.

Saving unrelated settings leaves unchanged MQTT secrets untouched, including the existing secrets
file's comments and formatting.

MQTT TLS `ca`, `cert`, and `key` accept file paths or inline PEM. Relative paths resolve from the
server's working directory; absolute paths are recommended for deployment. Files must be readable
by the server process. A missing TLS file rejects the change before the current client is stopped.
MQTT environment booleans accept `true` or `false`; malformed numeric and boolean values fail validation.

## Application boundaries

- `index.ts` composes the registry, transport, teach-in, MQTT, HTTP, and live-state services.
- `config/` owns environment resolution and validation shared with HTTP settings.
- `devices/types.ts` defines device records independently of configuration. `devices/registry.ts` owns normalized state and returns detached snapshots so callers cannot mutate it outside a persisted operation.
- `devices/commands.ts` is the shared command path for HTTP and MQTT. Encoding and decoding stay in `profiles/`.
- `transport/runtime.ts` owns connection replacement, recovery, packet reception, and connectivity events. Adapters handle serial/TCP I/O.
- `app/requestHandler.ts` requires the device registry, teach-in manager, and packet listener; it validates HTTP input and projects their state. Bun's registered routes serve the UI, without a filesystem or catch-all app-shell fallback. Settings resources serialize apply/save/rollback transactions. `app/stateUpdates.ts` broadcasts snapshots.
- `ui/liveSnapshot.ts` owns a reference-counted WebSocket store consumed through React's `useSyncExternalStore`. `ui/App.tsx` provides the live snapshot and device actions, without copying server state into component state.
- `ui/useSettingsForm.ts` keeps drafts local to each settings view and uses React Actions for pending, success, and error states. Live snapshots cannot overwrite unsaved drafts. Shared device and packet types are imported only as types, without bundling backend code in the browser.
- `components/` renders the management interface. The UI uses locally bundled fonts and icons, with no external asset service required.

The console opens at `/devices`, with search, compact power/mode controls, and expandable details,
rename, and removal. Device availability remains an integration concern rather than a list column or
filter. `/settings/transport` includes connection settings and read-only dongle hardware information.
Unregistered pages return 404; there is no `/settings/general` alias. Pairing and the RX/TX packet listener remain
separate workspaces. Navigation and device rows adapt to narrow screens.

Home Assistant discovery is configured only through `homeassistant.discoveryTopic` or
`HA_DISCOVERY_TOPIC`. MQTT discovery-prefix aliases and controller-ID overrides are not supported.
Outgoing commands use the device's assigned `sourceId`. MQTT fan speed commands use the integer
range advertised by discovery (for example, 0 for off and 1 through 4 for four speeds), not a
second 0-100 percentage format. HTTP/UI percentage commands remain normalized percentages.

## Development

From the repository root:

```sh
bun install
bun run dev
bun run check
```

`check` runs formatting, lint, type checking, tests, and builds both workspace packages. Individual
gates are available as `format:check`, `lint`, `typecheck`, `test`, and `build`. Type checking rejects
unused locals and parameters throughout the TypeScript tree. Use `bun run format`
to apply the repository formatter. Runtime `data/` directories are excluded; shipped configuration
templates remain checked. CI also builds the server Docker image before release jobs run.

The add-on build generates `packages/addon/dist` from its public templates and the server bundle.
Its manifest, lockfile subset, and add-on version are generated from workspace metadata; edit their
sources rather than generated output. The same applies to `routeTree.gen.ts`, generated by
`bun run --cwd packages/server generate-routes`. Installed dependencies, build outputs, release
binaries, and tool caches are not maintained source files.

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

### D2-50-00 ventilation

Fan commands use the six-byte control message (MT=1), with the direct operating mode in
the low nibble and CO2, humidity, and air-quality thresholds set to the specified default
value `0x7f`. Value 15 means no action, not a status request. Fan reports require a complete
14-byte basic-status message (MT=2); requests, controls, reserved modes, and truncated
telegrams cannot change device state. Reported operating modes are accepted independently
of the configured command capabilities and clear pending desired state.

The current adapter exposes fan operating mode only. Basic-status sensor/diagnostic fields,
extended-status telemetry, threshold controls, and remote status-request commands are not
yet exposed. All received telegrams remain available in the Packet Listener. These formats
follow EEP 2.6.8, D2-50-00 (pages 309-318); short vendor-specific status formats are not accepted.

Runtime-only device updates do not rewrite YAML. Home Assistant entities require both the bridge
and device to be online. Reassigning a sender channel clears the old discovery entries before
publishing the replacement, and MQTT shutdown drains active publications before offline cleanup.

### D5-00-01 contacts

Single Input Contact sensors use the receive-only `D5-00-01` profile with `capabilities: [contact]`
(also the default when omitted). DB0.0 is zero for open and one for closed; reports expose
`reportedState.open` as a boolean. The web UI shows Open/Closed, and Home Assistant discovers an
`opening` binary sensor. MQTT publishes `ON` for open and `OFF` for closed on
`<base_topic>/binary_sensor/<sourceId>/state`, including when Home Assistant is disabled.
No state is published until the first data telegram arrives. Commands are not supported.

### F6-02-01 rocker switches

Two-rocker switches using Application Style 1 use the receive-only `F6-02-01` profile with
`capabilities: [rocker]` (also the default when omitted). The RPS status byte distinguishes
N-messages from U-messages. N-messages expose `messageType: "N"`, the boolean `pressed`, and
one or two `buttons` in action order: `AI`, `A0`, `BI`, or `B0`. The second action is included
only when SA is set. U-messages expose `messageType: "U"`, `pressed`, and `buttonCount: 0`
or `"3_or_4"`; they do not identify individual buttons. A normal release is a U-message with
`pressed: false` and `buttonCount: 0`. Malformed payloads and missing or invalid RPS status
cannot update state. Commands are not supported.

Decoded fields are available in the web UI's reported state. MQTT publishes JSON on
`<base_topic>/binary_sensor/<sourceId>/state`, for example:

```json
{ "messageType": "N", "pressed": true, "buttons": ["AI", "BI"], "state": "ON" }
```

The `state` field is `ON` while pressed and `OFF` when released. Home Assistant discovers a
press/release binary sensor with the decoded fields as attributes. MQTT works independently
of Home Assistant; neither publishes a synthetic release before the first telegram.

## Pairing and Teach-In

Web-console pairing starts with `Pair` on a specific sender-channel row. There is no global
permit-join control in the web UI; `Cancel pairing` is available while a session is active.
When MQTT/Home Assistant is enabled, the integration exposes the discovered `Permit join`
switch with the `mdi:access-point-network` icon. The bridge also exposes a
`Restart` button with the `mdi:restart` icon. Both controls are attached to the bridge device.

Automatic joining uses the EEP Universal Teach-In (UTE) D4 telegram format. The server accepts
valid UTE teach-in queries for profiles present in its profile registry. Queries that expect a
response are accepted and persisted automatically during permit-join before a positive reply
is sent. Replies preserve the query's direction and echo its channel, manufacturer, and EEP.
They are not sent after the 500 ms response deadline; slow storage or failed transmission may
require repeating teach-in. Queries that request no response are never answered.
Unsupported EEPs receive `EEP not supported` when a response is requested. Teach-out,
unspecified teach-in/deletion, malformed, and reserved requests are not paired. Re-teaching
a known sender with a conflicting EEP is rejected without changing its existing profile.

D5-00-01 sensors also support 1BS teach-in: start pairing, then press the sensor's learn button.
Telegram DB0.3 must be zero for teach-in; ordinary contact reports do not create candidates.
The sender appears as a candidate without an EEP, even when a channel was selected. Select
`D5-00-01` and add the device explicitly: a 1BS learn telegram contains neither an EEP nor a
manufacturer ID (EEP 2.6.8, appendix 3.2). No teach-in response is sent, and no manufacturer or
channel metadata is inferred. Learn telegrams never update contact state.

For F6-02-01 switches such as PTM200, start pairing and press a rocker. RPS switches do not
send a dedicated teach-in telegram: a valid ordinary RPS telegram creates a candidate only
while pairing is active. Select `F6-02-01` explicitly and add the device, since the telegram
does not identify its EEP. No UTE response is sent and no manufacturer or channel metadata
is inferred. Alternatively, configure the sender ID as `targetId` with `profileId: F6-02-01`
in the device configuration. Subsequent press and release telegrams update device state.

For receiver-driven devices such as the AEROline vent, activate its local learn mode, then select
a free sender channel on the Pairing page and choose `Pair` in its row while the receiver's learning
window is open. Alternatively, use the Home Assistant permit-join switch.
The server broadcasts a D4 UTE query using the first free sender ID at or above `startId`; an
explicit channel selection takes precedence. A response must be addressed to that sender ID,
echo the outstanding query, and arrive within 700 ms. Because its EEP and manufacturer describe
the requester rather than the responding device, select the responding device's EEP explicitly
on the Pairing page before adding it; echoed manufacturer/channel data is not stored as device
metadata. Incoming supported queries on a selected channel can be accepted automatically.
Untargeted no-response queries remain candidates for manual acceptance. Pairing expires
after sixty seconds. Stopping or expiring a session clears pending candidates and channel targeting;
a failed transmission closes the session. A persistence operation already in progress may still
complete after cancellation, but it cannot send a late reply or close a newer session.
The USB 300 base ID is
read from the transport and shown read-only in Transport & dongle settings. It is not used as the last-used
allocation cursor and is not persisted in `configuration.yaml`.

Candidate sender IDs are reserved before acknowledgement and retained through acceptance, including
when several devices are discovered together. Configure `START_ID` or select an available channel
appropriate for the transceiver. Without an explicit start ID, allocation starts at the dongle's
base ID plus one when available, otherwise at one; it is never inferred from an existing device.

## Docker

Build from the repository root so the image uses the workspace lockfile:

```sh
docker build -f packages/server/Dockerfile -t eep-server .
docker run --rm -p 3000:3000 -v eep-data:/data eep-server
```

The build stage installs development tooling for route generation; the runtime stage contains
production dependencies and the generated server bundle. The Docker build context excludes local
configuration, secrets, databases, dependencies, and generated artifacts.

Use a secret store or environment injection for MQTT credentials. Do not commit `secrets.yaml` or passwords to `data/configuration.yaml`.
