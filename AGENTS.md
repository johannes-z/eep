# EnOcean2MQTT

EnOcean2MQTT is a Bun-based application with a web UI for managing EnOcean devices and exposing them through MQTT.

Its role is broadly comparable to Zigbee2MQTT, but for the EnOcean ecosystem. It provides a central interface for:

- Connecting to an EnOcean transceiver, such as the EnOcean USB 300.
- Discovering and pairing EnOcean devices.
- Managing paired devices.
- Encoding and decoding EnOcean packets according to their EEP profiles.
- Publishing device state through MQTT.
- Receiving state updates through MQTT.
- Integrating devices with Home Assistant.
- Inspecting EnOcean traffic for debugging and development.

The application acts as the bridge between:

```text
EnOcean Devices
       |
       v
EnOcean Transceiver
       |
       v
   Transport
 USB / TCP
       |
       v
 EnOcean2MQTT
   |       |
   v       v
 Web UI   MQTT
             |
             v
      Home Assistant /
      Other Consumers
```

## Core Concepts

### EnOcean Device

A device represents a physical EnOcean device known to the application.

A paired device typically contains information such as:

- EnOcean sender/device address.
- Friendly name.
- EEP profile.
- Device type.
- Target address or transceiver channel.
- Device-specific configuration.
- Current decoded state.

The EEP profile determines how raw EnOcean telegrams are interpreted and what functionality the device exposes.

### EEP Profile

EEP, or EnOcean Equipment Profile, describes the format and meaning of data exchanged by an EnOcean device.

The EEP implementation is responsible for translating between:

```text
Raw EnOcean Telegram
        |
        v
    EEP Decoder
        |
        v
Structured Device State
```

and, where supported:

```text
Requested Device Action
        |
        v
    EEP Encoder
        |
        v
Raw EnOcean Telegram
```

EEP profiles may also define device-specific actions that are exposed through the application.

### Friendly Name

Devices can be assigned a human-readable friendly name.

The friendly name is used by the UI and may also be used when constructing MQTT topics or external integration metadata.

The physical EnOcean address remains the stable hardware identifier.

### Target Address / Channel

Some EnOcean transceivers provide one or more addresses or channels that can be used when communicating with devices.

For hardware such as the USB 300, EnOcean2MQTT exposes these capabilities through the transport layer and UI.

A device may be paired against a specific target address or channel where required.

---

# Architecture

EnOcean2MQTT consists conceptually of the following major components:

```text
+---------------------------------------------------+
|                   Web UI                          |
|                                                   |
| Devices | Pairing | Packet Listener | Settings   |
+-------------------------+-------------------------+
                          |
                          v
+---------------------------------------------------+
|                Application Server                 |
|                                                   |
| Device Management                                 |
| Pairing / Teach-in                                |
| EEP Processing                                    |
| Configuration                                     |
| State Synchronization                             |
+-----------+----------------------+----------------+
            |                      |
            v                      v
+----------------------+   +------------------------+
| Transport Layer      |   | MQTT Integration       |
|                      |   |                        |
| Serial / USB         |   | State Publishing       |
| TCP / ser2net        |   | State Subscription     |
+----------+-----------+   | Home Assistant         |
           |               +------------------------+
           v
+----------------------+
| EnOcean Transceiver  |
+----------------------+
```

## Application Server

The application server runs on Bun and provides the backend used by the web UI.

Its responsibilities include:

- Managing transports.
- Managing known and paired devices.
- Processing incoming EnOcean packets.
- Encoding outgoing EnOcean packets.
- Performing teach-in flows.
- Synchronizing device state.
- Publishing and subscribing to MQTT topics.
- Providing application state to the web UI.
- Persisting runtime state where required.

The server is the authoritative runtime representation of the currently configured EnOcean network.

---

# Transport

The transport layer provides communication between EnOcean2MQTT and the EnOcean transceiver.

Supported transport types include:

- Direct serial connections, typically through USB.
- Remote serial connections exposed using `ser2net` or a compatible TCP bridge.

Example connection types:

```text
/dev/ttyUSB0
/dev/ttyACM0
tcp://192.168.1.10:2000
```

The transport abstraction should allow higher-level application functionality to operate independently from whether the transceiver is connected locally or remotely.

## USB / Serial Devices

For locally connected devices, EnOcean2MQTT uses `serialport`.

The application can expose information about available serial devices and their capabilities.

For supported EnOcean dongles, such as the USB 300, this may include:

- Device identification.
- Available EnOcean addresses or channels.
- Channel availability.
- Channel assignment.
- Pairing against a selected channel.

## TCP / ser2net

A serial transceiver may also be located on another machine and exposed over TCP.

Conceptually:

```text
EnOcean USB Dongle
       |
       v
    ser2net
       |
       v
      TCP
       |
       v
 EnOcean2MQTT
```

From the rest of the application, remote and local transports should behave as similarly as possible.

---

# Device State

Device state is shared between the EnOcean network, the application, the web UI, and MQTT.

The application should maintain a normalized representation of each device's current state.

An incoming EnOcean packet follows roughly this flow:

```text
EnOcean Telegram
       |
       v
Transport
       |
       v
Packet Parser
       |
       v
Identify Device
       |
       v
EEP Decoder
       |
       v
Update Device State
       |
       +----------------+
       |                |
       v                v
    Web UI            MQTT
```

Where supported, commands can flow in the opposite direction:

```text
MQTT / Web UI
       |
       v
Requested State / Action
       |
       v
EEP Encoder
       |
       v
EnOcean Telegram
       |
       v
Transport
       |
       v
Physical Device
```

---

# MQTT

MQTT is the primary external integration interface for device state.

Paired devices are exposed through MQTT topics.

MQTT integration is bidirectional where supported.

## EnOcean to MQTT

When an EnOcean packet changes the state of a known device:

1. The packet is received by the configured transport.
2. The sender is matched to a paired device.
3. The device's EEP profile decodes the packet.
4. The internal device state is updated.
5. The new state is published via MQTT.
6. The web UI reflects the updated state.

Conceptually:

```text
Device
  -> EnOcean
  -> EnOcean2MQTT
  -> Internal State
  -> MQTT
  -> Web UI
```

## MQTT to EnOcean2MQTT

When a relevant MQTT message is received:

1. The MQTT topic is mapped to a known device.
2. The payload is validated and interpreted.
3. Internal device state is updated as appropriate.
4. The web UI reflects the state change.
5. If the device and EEP support transmitting the requested action, the corresponding EnOcean telegram can be generated and sent.

Conceptually:

```text
MQTT
  -> EnOcean2MQTT
  -> Internal State
  -> Web UI
  -> EEP Encoder
  -> EnOcean Device
```

Not every EnOcean device is necessarily bidirectional. Whether a command can be transmitted depends on the device, EEP profile, and supported implementation.

---

# Device Management

## Devices Page

The Devices page lists all currently paired devices.

Typical information includes:

- Friendly Name
- EnOcean Address
- EEP Profile
- Target Address
- Device Type
- Current State
- Available Actions

Available management actions include:

- Rename device.
- Remove/delete device.
- Execute supported device actions.
- Inspect device information.
- Inspect device state.

Device-specific actions depend on the assigned EEP profile.

For example, one EEP implementation may expose actuator commands while another only exposes sensor values.

Removing a device removes the application's pairing/configuration for that device. It does not necessarily reset or modify the physical device itself unless an explicit unpairing procedure is implemented for that device type.

---

# Pairing and Teach-in

EnOcean devices generally use a teach-in mechanism rather than the discovery and interview process found in protocols such as Zigbee.

EnOcean2MQTT is responsible for handling supported teach-in procedures and creating the corresponding device configuration.

## UTE Teach-in

EnOcean2MQTT implements the Universal Teach-In, or UTE, flow.

The intended user workflow is:

1. Open the pairing interface.
2. Select an available EnOcean channel or target address.
3. Start pairing mode.
4. Trigger teach-in on the physical EnOcean device.
5. EnOcean2MQTT receives the teach-in telegram.
6. The application determines the device information and EEP where possible.
7. The UTE handshake is performed automatically.
8. The new device is created and persisted.
9. The device becomes available in the Devices page and via MQTT.

The user should not need to manually construct or exchange UTE telegrams.

Conceptually:

```text
User selects channel
        |
        v
Pairing mode enabled
        |
        v
Device sends UTE request
        |
        v
EnOcean2MQTT identifies device
        |
        v
UTE negotiation / response
        |
        v
Device configuration created
        |
        v
Device ready
```

Pairing should be treated as a temporary runtime state. The resulting device configuration is persistent.

---

# Packet Processing

Every EnOcean packet received by the transport can be processed at two levels:

1. Raw packet level.
2. Device / EEP level.

The raw packet representation is useful for debugging protocol communication.

The decoded representation is used by the device management, MQTT, and UI layers.

Conceptually:

```text
Raw Serial Data
      |
      v
EnOcean Packet Parser
      |
      +------------------> Packet Listener
      |
      v
Sender Identification
      |
      v
Device Lookup
      |
      v
EEP Decode
      |
      v
Application State
```

Unknown packets should still be observable through the packet listener even when they cannot be associated with a paired device.

---

# Packet Listener

The Packet Listener page provides a low-level view of EnOcean communication.

Its primary purpose is debugging, development, and troubleshooting.

The listener should allow users to inspect both received and transmitted packets.

Useful packet information includes:

- Direction, RX or TX.
- Timestamp.
- Packet type.
- Sender address.
- Destination address where applicable.
- Raw payload.
- Parsed payload.
- Signal information where available.
- Associated device.
- EEP decoding where available.

Typical use cases include:

- Diagnosing pairing problems.
- Identifying unknown EnOcean devices.
- Developing new EEP implementations.
- Verifying transmitted telegrams.
- Debugging transport issues.
- Comparing raw telegrams with decoded device state.

The packet listener should remain useful even when a packet cannot be decoded.

---

# Home Assistant Integration

EnOcean2MQTT optionally integrates with Home Assistant using MQTT Discovery.

When enabled, the application publishes the necessary Home Assistant discovery configuration for supported devices.

Conceptually:

```text
Paired EnOcean Device
        |
        v
EnOcean2MQTT
        |
        +----> Device State MQTT Topic
        |
        +----> Home Assistant Discovery Topic
                         |
                         v
                  Home Assistant
```

Integration may use:

- Home Assistant MQTT discovery topics.
- Home Assistant availability/status topics.
- Device state topics.
- Command topics for writable entities.
- Availability information.
- Device and entity metadata.

Home Assistant integration is optional. MQTT functionality should remain usable without Home Assistant enabled.

The EEP/device implementation determines which Home Assistant entities can meaningfully be created.

For example, depending on the device, entities may include:

- Sensors.
- Binary sensors.
- Switches.
- Lights.
- Buttons.
- Covers.
- Other supported Home Assistant MQTT entities.

---

# Configuration

EnOcean2MQTT separates user-managed configuration from runtime/internal state.

## `configuration.yaml`

Public, user-editable, and application-level configuration is stored in:

```text
configuration.yaml
```

This file is intended to be portable.

A user should be able to back up the file and reuse it when moving the application to another server or installation.

Configuration may include settings such as:

- MQTT connection settings.
- MQTT topic configuration.
- Home Assistant integration settings.
- Transport configuration.
- Application-level behavior.
- Other user-configurable options.

The configuration file should contain settings that are meaningful for users to inspect and modify.

Sensitive values should be handled appropriately and should not be exposed through logs or the UI unnecessarily.

## SQLite Database

Runtime and internal application data is stored in a lightweight SQLite database.

This can include data that is inappropriate or unnecessarily cumbersome to maintain manually in YAML, such as:

- Runtime state.
- Cached information.
- Internal metadata.
- Persistent device information.
- Pairing-related state.
- Other implementation-specific state.

As a general rule:

```text
configuration.yaml
    = user-controlled application configuration

SQLite
    = application-controlled persistent/runtime state
```

Code should avoid introducing user-facing settings into SQLite when they logically belong in `configuration.yaml`.

---

# Web UI

The web UI is the primary management interface for EnOcean2MQTT.

It should expose the state of the running backend rather than implementing separate device logic itself.

Conceptually:

```text
Web UI
   |
   v
Backend API / State
   |
   +--> Devices
   +--> Transports
   +--> Pairing
   +--> Packets
   +--> Configuration
   +--> MQTT State
```

The backend remains responsible for:

- EnOcean protocol handling.
- EEP processing.
- State management.
- MQTT communication.
- Persistence.
- Pairing logic.

The frontend is responsible primarily for:

- Displaying application state.
- Collecting user input.
- Triggering backend actions.
- Showing validation errors and operational status.

## Expected UI Areas

The application includes, or may expose, interfaces for:

### Devices

Manage paired devices and inspect their current state.

### Pairing

Select a transport/channel and initiate teach-in.

### Transports

Inspect available transports and EnOcean dongle capabilities.

### Packet Listener

Inspect incoming and outgoing EnOcean traffic.

### Configuration

Inspect or modify supported application settings.

---

# State Synchronization

Several application components can observe or modify state:

- Physical EnOcean devices.
- MQTT clients.
- The web UI.
- Pairing operations.
- Internal application processes.

Changes should converge on the same internal device representation.

For example:

```text
                 +--> Web UI
                 |
EnOcean ------> State <------ MQTT
                 |
                 +--> Persistence
```

The UI and MQTT integration should not maintain independent authoritative copies of device state.

Instead, they should reflect the backend's normalized application state.

This is especially important when implementing features that can update the same property from multiple sources.

---

# Error Handling

Failures in one integration should not unnecessarily prevent unrelated parts of the application from operating.

Examples:

- MQTT being unavailable should not prevent EnOcean packet reception.
- Home Assistant integration failing should not prevent regular MQTT operation.
- An unknown EEP should not prevent the raw packet from appearing in the Packet Listener.
- A malformed packet should not terminate the transport listener.
- One problematic device should not prevent other devices from being processed.

Errors should provide enough context to determine:

- Which component failed.
- Which device or transport was involved.
- Whether the operation can be retried.
- Whether user action is required.

---

# Logging

Logs should distinguish between major application areas where practical, for example:

```text
transport
mqtt
pairing
enocean
eep
device
home-assistant
database
server
```

Protocol-level debugging should provide sufficient information to correlate application behavior with packets visible in the Packet Listener.

Sensitive configuration values must not be logged.

---

# Development Guidelines for AI Agents

When modifying EnOcean2MQTT, preserve the separation between protocol handling, application state, transport, integrations, persistence, and presentation.

## General Rules

1. Do not put EnOcean protocol logic directly into UI components.
2. Do not put transport-specific behavior into EEP implementations.
3. Do not make MQTT state independent from the application's device state.
4. Keep user-editable configuration in `configuration.yaml` where appropriate.
5. Use SQLite for application-managed persistent/runtime data.
6. Keep raw packet handling independent from device recognition so unknown packets remain inspectable.
7. Device-specific encoding and decoding should live with the appropriate EEP implementation.
8. Assume that not every device supports outgoing commands.
9. Avoid assuming that the EnOcean transport is always a local USB device.
10. Keep Home Assistant integration optional and layered on top of MQTT/device functionality.

## When Adding an EEP

An EEP implementation should define, where applicable:

- How incoming telegrams are recognized.
- How raw fields are decoded.
- The structured state exposed to the application.
- Validation and value ranges.
- Supported outgoing commands.
- How commands are encoded into EnOcean telegrams.
- Device-specific actions.
- Home Assistant entity mappings where applicable.

The rest of the application should consume the structured EEP interface rather than parsing EEP-specific payloads itself.

## When Adding Device Functionality

Consider the complete state path:

```text
EnOcean
   |
EEP Decode
   |
Device State
   |
   +--> UI
   +--> MQTT
   +--> Home Assistant
```

For writable functionality, also consider:

```text
UI / MQTT
    |
Device Command
    |
EEP Encode
    |
EnOcean
```

A feature is generally incomplete if only one side of this flow has been implemented.

## When Changing Transport Code

Transport code should concern itself with moving EnOcean protocol data between the application and the transceiver.

Higher-level functionality should not need to know whether the transport is:

- Local serial.
- USB.
- TCP.
- ser2net.
- Another future transport implementation.

## When Changing MQTT Code

MQTT should expose application/device state, not recreate device behavior.

EEP-specific decoding should occur before MQTT publication.

Likewise, incoming commands should be converted into application/device actions before EEP encoding and transmission.

---

# Typical Workflows

## Application Startup

A typical startup sequence is:

```text
Load configuration.yaml
        |
        v
Initialize database
        |
        v
Load persisted devices/state
        |
        v
Initialize transport
        |
        v
Initialize MQTT
        |
        v
Initialize Home Assistant integration
        |
        v
Start web server / UI
        |
        v
Process EnOcean traffic
```

Individual integrations should handle reconnection or temporary unavailability where appropriate.

## Receive Device Update

```text
Receive packet
     |
Parse packet
     |
Identify sender
     |
Find paired device
     |
Decode using EEP
     |
Update internal state
     |
Publish MQTT state
     |
Notify/update UI
```

## Send Device Command

```text
Command from UI or MQTT
        |
Validate command
        |
Resolve device + EEP
        |
Encode EnOcean telegram
        |
Select target/channel
        |
Send using transport
        |
Update state as appropriate
```

## Pair Device

```text
Select target/channel
        |
Enable pairing
        |
Trigger physical device
        |
Receive teach-in packet
        |
Perform UTE flow
        |
Determine device / EEP
        |
Persist device
        |
Expose device to UI + MQTT
        |
Publish HA discovery if enabled
```

---

# Design Principle

The central abstraction in EnOcean2MQTT is the device state managed by the backend.

EnOcean, MQTT, Home Assistant, persistence, and the web UI are interfaces around that state:

```text
                 EnOcean
                    |
                    v
MQTT <------> Device State <------> Web UI
                    |
                    v
               Persistence
                    |
                    v
             Home Assistant
```

Protocol-specific responsibilities should remain at the edges of this architecture, while the central application works with normalized devices, states, and actions.
