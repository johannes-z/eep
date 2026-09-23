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
Outgoing commands use the device's `transmitId`, falling back to its legacy `sourceId`
when omitted. `transmitId: null` means no transmit channel. MQTT fan speed commands use the integer
range advertised by discovery (for example, 0 for off and 1 through 4 for four speeds), not a
second 0-100 percentage format. HTTP/UI percentage commands remain normalized percentages.

## A5-20-06 Heating Actuators

The Micropelt MVA005 is supported using the field definitions in
[A5-20-06](../../docs/A5-20-06.md). Support includes both control modes, status and
diagnostic decoding, cyclic replies, and manual 4BS variation 3 teach-in.
Remote commissioning (ReMan/ReCom), security-code changes, and link-table editing
are not implemented.

To pair, select an unused sender channel on the Pairing page, then hold the MVA005
wheel at either end stop until the first green flash after about five seconds.
The next action depends on the device revision:

- **REV1.5 (July 2020 manual):** turn to the **opposite end stop and immediately
  release**. Releasing alone does not complete the documented gesture. See
  [section 6.1](https://www.manualslib.de/manual/1106929/Micropelt-Mva005-Rev1-5-Enocean.html?page=11#manual).
- **March 2019 manual:** release at the first green flash, as shown in its
  [teach-in flowchart](https://www.manualslib.com/manual/1603033/Micropelt-Itrv-Mva-005.html?page=16#manual).

The first flash is not pairing confirmation: a subsequent green flash confirms
success; three red flashes indicate failure. Do not keep holding for ten seconds,
which is part of the manual reset sequence.
The server identifies `A5-20-06` and the manufacturer from the 4BS query
and automatically sends the variation 3 acknowledgement from the selected channel.
For Micropelt manufacturer `0049`, `80 30 49 80` is answered with `80 30 49 F0`,
not a UTE response. Mount the actuator and trigger its reference run as described
in the device manual. A failed radio write does not create a paired device. The
time-critical acknowledgement precedes pairing persistence; if persistence fails,
repeat pairing after resolving the storage error.

Commands update persistent desired state and are transmitted when the actuator
next reports, not immediately while it sleeps. Apply saves these settings even
while the transceiver is disconnected; they survive page reloads and server restarts.
The control form distinguishes unsaved edits, a successful save for delivery on
the next device telegram, and validation or storage errors. A save confirmation
does not mean the actuator has received the command. Devices requiring immediate
transmission still require a connected transport.
Every valid report receives a reply
from its assigned channel. Reported valve position and requested setpoint remain
separate. A reference-run request is cleared after a successful transport write;
this is not confirmation of physical execution. A failed write retains the request.
Without prior desired settings, the first reply preserves the reported absolute
setpoint or valve position where available, otherwise it uses 21 C. Later local
wheel adjustments are reported but do not override an explicit controller setpoint.

Device details expose control settings and reference-run. HTTP commands use
`POST /api/devices/<sourceId>/command`; MQTT JSON commands use
`<baseTopic>/climate/<sourceId>/command`. For example:

```json
{
  "mode": "temperature",
  "setpoint": 21.5,
  "roomTemperature": null,
  "communicationInterval": 0,
  "temperatureSensor": "ambient",
  "summerMode": false,
  "standby": false
}
```

- `mode`: `temperature` (0..40 C, 0.5 C steps) or `valvePosition` (0..100%, integer).
  Changing mode requires an explicit `setpoint`.
- `roomTemperature`: external measurement in 0.25 C steps, or `null` for the
  internal sensor. Zero cannot represent an external temperature in temperature mode.
- `communicationInterval`: `0` (automatic), `2`, `5`, `10`, `20`, `30`, `60`, or
  `120` minutes. Firmware `MVA005_V5.26.a.7` does not support 120 minutes.
- `temperatureSensor`: `ambient` or `flow`; requests the corresponding reading.
- `summerMode`: eight-hour communication interval. `standby` requires local wake-up.
- `referenceRun`: `true` queues a one-shot reference run.

MQTT additionally accepts numeric temperatures at `.../temperature/set` and
`heat`/`off` at `.../mode/set`. Off requests a closed valve, not hardware standby;
heat restores the last temperature-control setpoint (21 C if none was saved).
The persisted `temperatureSetpoint` retains that value while `setpoint` represents
a valve percentage. Selecting heat or a temperature through MQTT clears summer
mode and standby. The climate entity shows off during direct valve control: the
internal temperature controller is inactive, even if the valve is open.

The persisted `valveSetpoint` likewise retains the last direct valve target when
switching to heat. The `Valve target` number stays visible in heat mode, but is
inactive until a new valve command selects direct control. Before any valve
target is known, it remains unknown rather than assuming a measured position.
An explicit climate off command sets the valve target to 0%; a subsequent
`Valve target` command overrides that request and can open the valve even while
the climate entity still displays off. Climate off is not a global lockout.
Only the latest selected control mode and its setpoint are transmitted on wake;
the remembered target for the other mode is not transmitted.

Home Assistant discovers the following entities under the same device:

| Entity                   | Meaning                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------- |
| Climate                  | Internal temperature control, target 0..40 C in 0.5 C steps                           |
| Valve target             | Direct valve control, 0..100%; a command selects valve mode and clears summer/standby |
| Valve position           | Actual reported valve opening, independent of the requested target                    |
| Ambient temperature      | Reported room-side temperature, also used by the climate entity                       |
| Flow temperature         | Reported heating-flow temperature, never treated as room temperature                  |
| Local temperature offset | Reported relative wheel adjustment in K, not an absolute target or writable setting   |
| Energy storage low       | Binary low-energy indication, equivalent to the ETS low-battery object                |
| Summer mode              | Switch for the desired summer-mode setting                                            |

This separates the functions often exposed as ETS objects (valve percentage,
actual temperature, low battery, relative setpoint, summer mode). ETS group
addresses are not MQTT identifiers; no KNX routing is implemented here.
Only the requested ambient or flow sensor is present in each telegram. The
other temperature entity is unknown. In absolute local-offset mode the relative
offset entity is also unknown; `localOffset` and `localOffsetMode` remain in the
JSON attributes.

JSON state at `.../state` includes diagnostics, desired settings,
`currentTemperature`, `flowTemperature`, `targetTemperature`, `valvePosition`,
and `requestedValvePosition`. The remembered temperature target is published
even before the first status report and in valve mode so HA can offer temperature
control. It is not an acknowledgement from the actuator. Measurements remain
`null` until reported. After teach-in the MVA005 stays in mounting position;
activate it locally with a brief end-stop turn and release, as described in the
manual, to start its reference run and periodic reports. A queued MQTT reference
run cannot wake an inactive actuator.

If all reported sensors remain unknown and no normal A5 telegram arrives after
teach-in, first verify local activation, not the HA target values. On a mounted
MVA005 REV1.5, turn the wheel briefly to either end stop and immediately release
(do not hold for the five-second teach-in gesture). Section 6.1 of the
[REV1.5 manual](https://www.manualslib.de/manual/1106929/Micropelt-Mva005-Rev1-5-Enocean.html?page=11#manual)
describes a reference run, one green flash for success or three red flashes for
failure, and two-minute radio intervals during the first 30 minutes. An
unmounted actuator returns to mounting position. If activation fails or RX is
still absent, inspect the current installation's logs; changing desired settings
cannot create sensor readings or confirm physical execution.

Reserved readings and sensor faults produce `null` readings rather than misleading
temperatures; `temperatureError` distinguishes the explicit sensor-error code.
MQTT remains usable with Home Assistant disabled.

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

The configuration key (`sourceId` in the API) is the stable application/MQTT identity;
`targetId` is the physical device address. For legacy transmitting devices the key also
supplies the transmit address unless `transmitId` overrides it. Receive-only profiles
automatically use `transmitId: null` and never reserve a USB 300 channel. Newly discovered
receive-only devices use their physical address as their configuration key. Existing
devices keep their key and MQTT/Home Assistant identities while their old channel becomes
available for reuse. If that channel is reused, the new device can have a separate stable
key and an explicit `transmitId`. No database schema change or re-pairing is needed.

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

The aggregate `state` field is `ON` while pressed and `OFF` when released. Home Assistant
discovers four momentary binary sensors, AI, A0, BI, and B0, sharing this JSON topic.
Only identified pressed buttons turn On; release or unidentified U-messages leave all four
Off. The initial payload is `{"state":"OFF"}` and server startup clears saved button
presses. MQTT reconnects preserve live state. MQTT works independently of Home Assistant.

## Pairing and Teach-In

Receive-only F6-02-01 switches and D5-00-01 contacts appear under **Discovered devices**
whenever supported telegrams arrive, including outside pairing mode. Select the EEP and
choose **Add device** to register one explicitly; discovery alone does not pair a device.
No USB 300 sender channel or outgoing telegram is needed. Paired devices are not listed
again. Cancelling channel pairing preserves passive discoveries. The passive list retains
at most 128 senders and expires entries after five minutes without another telegram.

**Dismiss** removes a candidate until its next telegram. **Ignore device** removes it
from discovery and suppresses future candidates from that address, including during channel
pairing. The **Ignored devices** list provides **Allow discovery** to clear an entry;
the device can appear again when its next supported telegram arrives. Ignoring does not
pair or control the device, and raw packets remain visible in the Packet Listener.

Ignored physical sender addresses are stored in the portable `configuration.yaml` and
survive restarts, for example:

```yaml
ignoredDevices:
  - '05010203'
```

For devices requiring outgoing communication, pairing starts with `Pair` on a specific sender-channel row. There is no global
permit-join control in the web UI; `Cancel pairing` is available while a session is active.
When MQTT/Home Assistant is enabled, the integration exposes the discovered `Permit join`
switch with the `mdi:access-point-network` icon. The bridge also exposes a
`Restart` button with the `mdi:restart` icon. Both controls are attached to the bridge device.

`Restart` gracefully closes and reinitializes the application in the same process, reloading
configuration and persisted device state. HTTP/WebSocket and MQTT connections are briefly
interrupted and then reconnect. No external process supervisor is required. `SIGINT` and
`SIGTERM` still shut down the server without restarting it.

Automatic joining uses the EEP Universal Teach-In (UTE) D4 telegram format. The server accepts
valid UTE teach-in queries for profiles present in its profile registry. Queries that expect a
response are accepted and persisted automatically during permit-join before a positive reply
is sent. Replies preserve the query's direction and echo its channel, manufacturer, and EEP.
They are not sent after the 500 ms response deadline; slow storage or failed transmission may
require repeating teach-in. Queries that request no response are never answered.
Unsupported EEPs receive `EEP not supported` when a response is requested. Teach-out,
unspecified teach-in/deletion, malformed, and reserved requests are not paired. Re-teaching
a known sender with a conflicting EEP is rejected without changing its existing profile.

D5-00-01 sensors are discovered from ordinary contact reports or their 1BS learn button.
Telegram DB0.3 is zero for teach-in and one for data. The sender appears as a candidate
without an EEP, independently of channel pairing. Select
`D5-00-01` and add the device explicitly: a 1BS learn telegram contains neither an EEP nor a
manufacturer ID (EEP 2.6.8, appendix 3.2). No teach-in response is sent, and no manufacturer or
channel metadata is inferred. Learn telegrams never update contact state.

For F6-02-01 switches such as PTM200, press a rocker. RPS switches do not
send a dedicated teach-in telegram: a valid ordinary RPS telegram creates a passive candidate
without starting pairing. Select `F6-02-01` explicitly and add the device, since the telegram
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
after sixty seconds. Stopping or expiring a session clears pending channel-pairing candidates and channel targeting;
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
