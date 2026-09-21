# UTE - Universal Uni- and Bidirectional Teach-in

## Quelle

EnOcean Equipment Profiles (EEP), Version 2.6.8, Dec 31, 2017, Appendix 3.6, pages 327-329.

## Allgemeines

RORG to be used: `0xD4` Universal Teach-in, EEP based (UTE).

FUNC and TYPE shall be represented as 8bit parameters, both with a value range from `0x00 ... 0xFF`. This aligns UTE with the EEP representation defined for SmartACK teach-in.

UTE allows handling of teach-in and teach-out requirements for EEP based communication of all different RORG. It is an alternative to SmartACK teach-in for devices where SmartACK is not applicable.

### Abgrenzung

The proposed Universal Teach-In Procedure is able to cover EEPs based on RPS, 1BS and 4BS messages as well, but it is not intended to replace:

- the existing RPS, 1BS and 4BS teach-in / teach-out procedures for unidirectional communication;
- the existing 4BS teach-in / teach-out procedures for bidirectional communication.

It is recommended that with the acceptance of the proposed Universal Teach-In Procedure all new bidirectional 4BS applications shall use it for teach-in and teach-out as well.

UTE is dedicated to EEP based EnOcean communication. It does neither compete with nor shall it interfere with the teach-in process of the Generic EnOcean Communication.

## Kommunikationsprinzipien

### Bidirectional EEP-based communication

Bidirectional EnOcean communication means a point-to-point communication relationship between two enabled EnOcean devices. It requires all parties involved to know the unique EnOcean ID of their partners.

Such point-to-point communication relationship is established with the completion of a successful teach-in process and it is deleted with the completion of a successful teach-out process.

To get a maximum reliable teach-in process with a minimum consumption of energy and resources, a simple query-response mechanism is used:

1. The device that is intended to be taught-in broadcasts a query message.
2. A device in learn mode answers with an addressed response message.
3. The response contains the EnOcean ID of the requesting device as the transmission target address.

If more than one device is ready to accept teach-in query messages at the same time and within the same radio range, the device with the quickest response time will be accepted by the device to be taught-in. Second and further devices will respond as well but they will not be accepted by the device to be taught-in.

### Unidirectional EEP-based communication

Unidirectional EnOcean communication means a point-to-multipoint communication relationship. The device to be taught-in does not know the unique EnOcean IDs of its communication partners.

UTE supports unidirectional communication through related configuration bits in the query message. For specific applications, for example configuration feedback, bidirectional teach-in can also be combined with unidirectional EEP-based communication during regular operation.

## EEP Teach-In Query - UTE Message

**Transmission:** Broadcast  
**Command:** `0x0`  
**Payload:** 7 bytes

This message is sent by the EEP based EnOcean device that is intended to be taught-in to another device. The receiving device has been set into LRN-mode before, either manually or through a ReMan command.

If a response is expected it shall be received within a maximum of 700 ms from the transmission of this message. If no response is received within this time, the query action shall be treated as completed with negative result. If no response is expected, each query action has to be treated as completed with positive result.

| Offset | Size | Bitrange        | Value           | Description                                      |
| -----: | ---: | --------------- | --------------- | ------------------------------------------------ |
|      0 |    1 | DB6.7           | `0b0`           | Unidirectional communication (EEP operation)     |
|      0 |    1 | DB6.7           | `0b1`           | Bidirectional communication (EEP operation)      |
|      1 |    1 | DB6.6           | `0b0`           | EEP Teach-In-Response message expected           |
|      1 |    1 | DB6.6           | `0b1`           | No EEP Teach-In-Response message expected        |
|      2 |    2 | DB6.5 ... DB6.4 | `0b00`          | Teach-in request                                 |
|      2 |    2 | DB6.5 ... DB6.4 | `0b01`          | Teach-in deletion request                        |
|      2 |    2 | DB6.5 ... DB6.4 | `0b10`          | Teach-in or deletion of teach-in, not specified  |
|      2 |    2 | DB6.5 ... DB6.4 | `0b11`          | Not used                                         |
|      4 |    4 | DB6.3 ... DB6.0 | `0x0`           | Command identifier (CMD), EEP Teach-In Query     |
|      8 |    8 | DB5.7 ... DB5.0 | `0x00 ... 0xFE` | Number of individual channel to be taught in     |
|      8 |    8 | DB5.7 ... DB5.0 | `0xFF`          | Teach-in of all channels supported by the device |
|     16 |    8 | DB4.7 ... DB4.0 | -               | MID, Manufacturer-ID, 8 LSBs                     |
|     24 |    5 | DB3.7 ... DB3.3 | -               | Do not use                                       |
|     29 |    3 | DB3.2 ... DB3.0 | -               | MID, Manufacturer-ID, 3 MSBs                     |
|     32 |    8 | DB2.7 ... DB2.0 | `0x00 ... 0xFF` | TYPE of EEP                                      |
|     40 |    8 | DB1.7 ... DB1.0 | `0x00 ... 0xFF` | FUNC of EEP                                      |
|     48 |    8 | DB0.7 ... DB0.0 | `0x00 ... 0xFF` | RORG of EEP                                      |

## EEP Teach-In Response - UTE Message

**Transmission:** Addressed  
**Command:** `0x1`  
**Payload:** 7 bytes

This message is the reply to an EEP Teach-In Query message. It is sent by the EEP based EnOcean device that has been set into LRN-mode before, either manually through HMI or through a ReMan command.

If a response is requested, this message shall be sent within a maximum of 500 ms from reception of the EEP Teach-In Query message. This limit shall give sufficient time to decide on the teach-in request and answer accordingly, for example when requests need to be processed by database systems connected asynchronously.

| Offset | Size | Bitrange        | Value           | Description                                          |
| -----: | ---: | --------------- | --------------- | ---------------------------------------------------- |
|      0 |    1 | DB6.7           | `0b0`           | Unidirectional communication (EEP operation)         |
|      0 |    1 | DB6.7           | `0b1`           | Bidirectional communication (EEP operation)          |
|      1 |    1 | DB6.6           | -               | Not used                                             |
|      2 |    2 | DB6.5 ... DB6.4 | `0b00`          | Request not accepted, general reason                 |
|      2 |    2 | DB6.5 ... DB6.4 | `0b01`          | Request accepted, teach-in successful                |
|      2 |    2 | DB6.5 ... DB6.4 | `0b10`          | Request accepted, deletion of teach-in successful    |
|      2 |    2 | DB6.5 ... DB6.4 | `0b11`          | Request not accepted, EEP not supported              |
|      4 |    4 | DB6.3 ... DB6.0 | `0x1`           | Command identifier (CMD), EEP Teach-In Response      |
|      8 |    8 | DB5.7 ... DB5.0 | `0x00 ... 0xFE` | Echo of the individual channel to be taught in       |
|      8 |    8 | DB5.7 ... DB5.0 | `0xFF`          | Echo that all supported channels are to be taught in |
|     16 |    8 | DB4.7 ... DB4.0 | -               | Echo of MID, Manufacturer-ID, 8 LSBs                 |
|     24 |    5 | DB3.7 ... DB3.3 | -               | Not used; echoed query field                         |
|     29 |    3 | DB3.2 ... DB3.0 | -               | Echo of MID, Manufacturer-ID, 3 MSBs                 |
|     32 |    8 | DB2.7 ... DB2.0 | `0x00 ... 0xFF` | Echo of TYPE of EEP                                  |
|     40 |    8 | DB1.7 ... DB1.0 | `0x00 ... 0xFF` | Echo of FUNC of EEP                                  |
|     48 |    8 | DB0.7 ... DB0.0 | `0x00 ... 0xFF` | Echo of RORG of EEP                                  |

The addressed response target is the EnOcean ID of the device that sent the query. The echoed metadata identifies the requesting EEP, manufacturer and channel; it is not a replacement for the responder's own identity.
