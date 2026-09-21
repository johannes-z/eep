# Teach-in-Verfahren

## Quelle

EnOcean Equipment Profiles (EEP), Version 2.6.8, Dec 31, 2017, sections 1.7 and Appendix 3.1-3.5, pages 13 and 320-326.

## Allgemeine Beschreibung

The 'Teach-in' defines the mutual communication between wireless devices in an 868 (315) MHz radio network. The 'Teach-in' defines to which transmitter(s) a receiver needs to listen to.

For this purpose of a determined relationship between transmitter and receiver each transmitting device has a unique Sender-ID which is part of each radio telegram. The receiving device detects from the Sender-ID whether the device is known, i.e., was already learned, or unknown.

A telegram with unknown Sender-ID is disregarded.

The 'teach-in' process is different for each telegram type (RPS, 1BS, 4BS, Smart Ack), but the following points are valid for all telegrams:

- First, the receiver must be switched into learning mode. Now, the Sender-ID of an arriving telegram is interpreted as an authorized information source and will be stored at the receiver. The further steps of 'teach-in' are defined by the device type or the telegram type. Thus, normal data telegrams or special teach-in telegrams can be used. Frequently, a learn button triggers the teach-in process.
- The telegram of the respective transmitter should be triggered at least once, by pressing the desired switch rocker or triggering a sensor.
- The bits of the payload (data bytes) can have multiple functions depending on the interpretation set by identification or status bits. Only in the 1BS and 4BS telegram the 'LRN BIT' DB_0.BIT_3 is reserved exclusively and must not be used elsewhere.

The following issues are relevant for a number of applications but not mandatory from a specification perspective:

- To prevent unwanted devices from being learned the input sensitivity of the receiver is often restricted, and thus an IN-ROOM operation is created. Typically, the device to be learned is placed close by the receiver.
- Dolphin-based transmitters, e.g. TCM 300 or TCM 2x with Dolphin library, can also be switched into the learn-mode via a remote management command. This remote 'teach-in' mode can only be activated within the first 30 min after receiver power-up. To avoid inadvertent learning the transmitter telegrams have to be triggered 3 times within 2 seconds.

## RPS Teach-in

The RPS telegram can only send data and has no special telegram modification to teach-in the device. Therefore, the teach-in procedure takes place manually on the actuator/controller through a normal data telegram. The EEP profile must be manually supplied to the controller per sender ID.

In learn mode, the receiving actuator reduces the input sensitivity in order to fade out weakly received data telegrams. This helps avoid inadvertently teaching-in sensors.

## 1BS Teach-in

The 1BS telegram has its own teach-in telegram, which can signal the teach-in command through the `DB_0.BIT_3` data bit.

| Offset | Size | Bitrange | Valid range |
|---:|---:|---|---|
| 4 | 1 | DB0.3, LRN Bit | `0`: Teach-in telegram; `1`: Data telegram |

Here, an EEP profile must also be manually allocated per sender ID.

## 4BS Teach-in

The 4BS telegram also has its own teach-in telegram, with more teach-in variations.

### Variation 1

The profile-less unidirectional teach-in procedure functions according to the same principle as the 1BS telegram: if the data bit is `DB_0.BIT_3 = 0`, then a teach-in telegram is sent. This includes the 'LRN TYPE' `DB_0.BIT_7 = 0` data bit. Then no EEP profile identifier and no manufacturer ID are transferred.

| Offset | Size | Bitrange | Valid range |
|---:|---:|---|---|
| 24 | 1 | DB0.7, LRN Type | `0`: telegram without EEP and Manufacturer ID |
| 28 | 1 | DB0.3, LRN Bit | `0`: Teach-in telegram; `1`: Data telegram |

### Variation 2

For the unidirectional profile teach-in procedure, it is preferred, in opposite to variation 1, as the teach-in telegram contains both the complete EEP number and the manufacturer ID. The device is therefore clearly identifiable as ready-to-use and can be securely executed in a complex system environment or by foreign systems. In this case, the 'LRN TYPE' data bit is `DB_0.BIT_7 = 1`.

| Offset | Size | Bitrange | Valid range |
|---:|---:|---|---|
| 24 | 1 | DB0.7, LRN Type | `1`: telegram with EEP number and Manufacturer ID |
| 28 | 1 | DB0.3, LRN Bit | `0`: Teach-in telegram; `1`: Data telegram |

### Variation 3

During the bidirectional teach-in procedure, further bits are required from DB_0 in order to develop the mutual teach-in between two communication partners. The procedure is made up of two teach-in telegrams, which are exchanged on both sides.

| Offset | Size | Bitrange | Data | Valid range |
|---:|---:|---|---|---|
| 24 | 1 | DB0.7 | LRN Type | `0`: telegram without EEP and Manufacturer ID; `1`: telegram with EEP number and Manufacturer ID |
| 25 | 1 | DB0.6 | EEP Result | `0`: EEP not supported; `1`: EEP supported |
| 26 | 1 | DB0.5 | LRN Result | `0`: Sender ID deleted/not stored; `1`: Sender ID stored |
| 27 | 1 | DB0.4 | LRN Status | `0`: Query; `1`: Response |
| 28 | 1 | DB0.3 | LRN Bit | `0`: Teach-in telegram; `1`: Data telegram |

## Smart Ack Teach-in ohne Repeater

Under Smart Ack (SA), the teach-in procedure is more complex as, alongside the SA client and SA controller, a Postmaster must also be established to prepare a mailbox for each taught-in SA client. The Postmaster is normally found in the controller. If a repeater is installed, then a postmaster is set up there.

After the learn mode is activated on the controller, the teach-in procedure can be started on the client. The client sends an `SA_LEARN_REQUEST` telegram:

| Data | Value | Description |
|---|---|---|
| Request Code | `0b11111` | Default value - send by sensor |
| Manufacturer ID | `0bnnnnnnnnnnn` | Corresponding to the teach-in sensor |
| EEP No. | `0xnnnnnn` | RORG, FUNC, TYPE |
| RSSI | `0x00` | 0 = Without repeater |
| Repeater ID | `0x00000000` | 0 = Without repeater |
| Sender ID | `0xnnnnnnnn` | Chip ID of sensor for teach-in |
| Status | `0x0F` | 0F = no repeating permitted |
| CHCK | `0xnn` | Checksum |

During the response period in the SA client, which is always 550 ms during teach-in, the controller creates a new mailbox in its postmaster and leaves its first message there with an OK receipt. This entry is requested from the postmaster by the SA client with an `SA_RECLAIM` 'Learn' telegram:

| Data | Value | Description |
|---|---|---|
| Message Index | `0b0` | Bit 7: 0 = Learn Reclaim |
| Sender ID | `0xnnnnnnnn` | Chip ID of sensor for teach-in |
| Status | `0x0F` | 0F = no repeating desired |
| CHCK | `0xnn` | Checksum |

The final telegram sent to the SA client, `SA_LRN_ANSWER`, contains the 'Learn Acknowledge' message from the mailbox that the teach-in procedure has been carried out successfully.

| Data | Value | Description |
|---|---|---|
| RORG | `0xA6` | A6 = ADR Telegram |
| RORG-EN | `0xC7` | RORG encapsulated / C7 = SA_LRN_ANSWER |
| Index | `0x02` | Message Index; 02 = Learn Acknowledge |
| Response time | `0xnnnn` | Response time in ms in which the controller can prepare the data and send it to the postmaster; maximum 550 ms = `0x0226` |
| Acknowledge code | `0x00` | First Learn In successful |
| Mailbox index | `0xnn` | Index number of the assigned mailbox |
| Postmaster ID | `0xnnnnnnnn` | Device ID of the Postmaster candidate |
| Controller ID | `0xnnnnnnnn` | Device ID of the assigned controller |
| Status | `0x0F` | 0F = no repeating permitted |
| CHCK | `0xnn` | Checksum |

## Smart Ack Teach-in mit Repeater

If a repeater comes into operation, it takes over the task of the postmaster after the teach-in procedure. The `SA_LEARN_REQUEST` telegram sent by the SA client, with an EEP number, Manufacturer ID and Sender ID, is completed on the repeater with the RSSI value and the Repeater ID, and sent to the controller.

The controller can recognize from the received RSSI which repeater is best suited as postmaster. The SA client remains in its response period.

The addressed `SA_LRN_ANSWER` telegram with the message 'Learn Reply' by the controller to the repeater ensures that the postmaster is activated and a mailbox is created.

| Data | Value | Description |
|---|---|---|
| RORG | `0xA6` | A6 = ADR Telegram |
| RORG-EN | `0xC7` | RORG encapsulated / C7 = SA_LRN_ANSWER |
| Index | `0x01` | Message Index; 01 = Learn Reply |
| Response time | `0xnnnn` | Response time in ms; maximum 550 ms = `0x0226` |
| Acknowledge code | `0x00` | First Learn In successful |
| Sender ID | `0xnnnnnnnn` | Chip ID of sensor to be taught-in |
| Postmaster ID | `0xnnnnnnnn` | Device ID of the Postmaster candidate |
| Controller ID | `0xnnnnnnnn` | Device ID of the assigned controller |
| Status | `0x0F` | 0F = no repeating permitted |
| CHCK | `0xnn` | Checksum |

A mailbox is created for the SA client in the repeater's postmaster. An initial entry with an OK message is left there. The client requests this information from the repeater's postmaster with the `SA_RECLAIM` 'Learn' telegram. The final `SA_LRN_ANSWER` is the same Learn Acknowledge sequence described above, with mailbox index, Postmaster ID and Controller ID.

## Related procedure

The Universal Uni- and Bidirectional Teach-in (UTE) procedure is documented separately in [ute.md](ute.md).
