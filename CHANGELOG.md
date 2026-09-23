# Changelog

All notable changes to this project will be documented in this file.
## Unreleased


### Bug Fixes

- Add temperature and humidity display for sensor devices in DeviceRow (b3fbdd2)


### Features

- Implement explicit EEP teach-in requirement for A5 sensor discovery and enhance teach-in manager logic (7ce8658)

## v1.8.0


### Features

- Enhance A5-20-06 profile with valve setpoint management and improve command handling (6eec586)

- Add A5-04-01 temperature and humidity sensor profile with decoding and testing (163049e)


### Miscellaneous

- Release v1.8.0 (8e1a203)

## v1.7.0


### Features

- Enhance A5-20-06 profile with temperature setpoint management and improve MQTT entity discovery (ef00315)

- Enhance command delivery handling and improve device command management (5d96d1f)


### Miscellaneous

- Release v1.7.0 (a813558)

## v1.6.0


### Bug Fixes

- Correct targetId usage in PacketRow and ensure proper formatting in PacketListener (9cd2809)


### Features

- Add A5-20-06 profile for Micropelt heating actuator (8a14cab)

- Refactor packet listener to use SQLite for persistent storage and improve packet management (10e258a)

- Update A5-20-06 teach-in instructions and add revision-specific details in documentation (ab2018b)


### Miscellaneous

- Release v1.6.0 (88435ab)

## v1.5.0


### Features

- Enhance device management with transmitId support for receive-only devices (2d8dae6)

- Preserve Home Assistant discovery and publish offline availability on bridge stop (49c8ad4)

- Implement ignored devices management in pairing process (0f9e06d)

- Improve candidate profile selection logic in pairing component (3e73f77)


### Miscellaneous

- Release v1.5.0 (4ff5fb9)

## v1.4.0


### Features

- Implement momentary button sensors for F6-02-01 profile and enhance MQTT discovery (e304464)


### Miscellaneous

- Release v1.4.0 (9fcb724)

## v1.3.0


### Features

- Enhance transport settings to display dongle hardware information (50f7edc)

- Update server dependencies and implement application lifecycle management (85ee603)


### Miscellaneous

- Release v1.3.0 (e3c9589)

## v1.2.0


### Documentation

- Add docs (15f6693)


### Features

- Add F6-02-01 rocker switch profile and support (44bdb96)


### Miscellaneous

- Release v1.2.0 (243e212)


### Refactoring

- Remove TeachInManager references and related code from MQTT integration (a2fa45d)

## v1.1.0


### Features

- Update device teach-in info to allow optional channel and manufacturerId (86680f9)


### Miscellaneous

- Release v1.1.0 (0f801bb)


### Refactoring

- Remove pending state styles and related markup from DeviceRow (5977ad9)

## v1.0.5


### Miscellaneous

- Release v1.0.5 (d045e5d)

## v1.0.4


### Miscellaneous

- Release v1.0.4 (2fca6f1)

## v1.0.3


### Miscellaneous

- Release v1.0.3 (8b9d9c0)

## v1.0.2


### Bug Fixes

- Fixes (755158c)


### Miscellaneous

- Release v1.0.2 (fb309e5)


### Refactoring

- Refactor (1a84656)

## v1.0.1


### Bug Fixes

- Fix filename (2ec3ed9)

- Fixes (c2b3a28)

- Fix (d5c6e5e)

- Fixes (dc60924)


### Features

- Add fan profile tests and implement fan state mappings (ffefd25)


### Miscellaneous

- Release v1.0.1 (62c7bfa)

