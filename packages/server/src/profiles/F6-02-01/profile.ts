import type { EepProfile, JsonValue, ProfileStateField } from '../types';

const buttons = ['AI', 'A0', 'BI', 'B0'] as const;
type RockerButton = (typeof buttons)[number];
type RockerState =
  | { messageType: 'N'; pressed: boolean; buttons: RockerButton[] }
  | { messageType: 'U'; pressed: boolean; buttonCount: 0 | '3_or_4' };

function isButton(value: unknown): value is RockerButton {
  return buttons.some((button) => button === value);
}

function rockerState(value: unknown, field: ProfileStateField): RockerState {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !('pressed' in value) ||
    typeof value.pressed !== 'boolean' ||
    !('messageType' in value)
  ) {
    throw new Error(`Invalid ${field} for F6-02-01`);
  }
  if (
    value.messageType === 'N' &&
    'buttons' in value &&
    Array.isArray(value.buttons) &&
    value.buttons.length >= 1 &&
    value.buttons.length <= 2 &&
    value.buttons.every(isButton)
  ) {
    return { messageType: 'N', pressed: value.pressed, buttons: [...value.buttons] };
  }
  if (
    value.messageType === 'U' &&
    'buttonCount' in value &&
    (value.buttonCount === 0 || value.buttonCount === '3_or_4')
  ) {
    return { messageType: 'U', pressed: value.pressed, buttonCount: value.buttonCount };
  }
  throw new Error(`Invalid ${field} for F6-02-01`);
}

function readOnly(): never {
  throw new Error('F6-02-01 rocker switches are read-only');
}

export const f6Profile: EepProfile = {
  metadata: {
    id: 'F6-02-01',
    rorg: 0xf6,
    description: 'Light and Blind Control - Application Style 1',
  },
  transientReportedState: true,

  entity: {
    describe: () => ({
      kind: 'binary_sensor',
      jsonState: true,
      discoveryEntities: buttons.map((button) => ({
        key: button.toLowerCase(),
        name: button,
        valueTemplate: `{{ 'ON' if value_json.messageType | default('') == 'N' and value_json.pressed | default(false) and '${button}' in value_json.buttons | default([]) else 'OFF' }}`,
      })),
      publishInitialState: true,
      protocol: 'F6-02-01 rocker switch',
      power: false,
      commands: [],
    }),
    projectState: (context) => {
      if (context.reportedState === undefined) return { isOn: false };
      const state = rockerState(context.reportedState, 'reportedState');
      return { isOn: state.pressed, attributes: state };
    },
    parseCommand: readOnly,
  },

  defaultCapabilities: () => ['rocker'],
  validateCapabilities(value: unknown): JsonValue {
    if (!Array.isArray(value) || value.length !== 1 || value[0] !== 'rocker') {
      throw new Error('Invalid F6-02-01 capabilities');
    }
    return ['rocker'];
  },
  validateState(value, field) {
    if (field === 'desiredState') return readOnly();
    return rockerState(value, field);
  },

  decodeIngress(_context, packet) {
    const status = packet.status;
    if (
      packet.RORG !== 0xf6 ||
      packet.teachIn ||
      packet.payload.length !== 1 ||
      status === undefined ||
      !Number.isInteger(status) ||
      status < 0 ||
      status > 0xff ||
      (status & 0x20) === 0
    ) {
      return { kind: 'ignored' };
    }
    const data = packet.payload[0];
    if (!Number.isInteger(data) || data < 0 || data > 0xff) return { kind: 'ignored' };
    const pressed = (data & 0x10) !== 0;
    const firstAction = data >> 5;
    let state: RockerState;
    if ((status & 0x10) !== 0) {
      const secondAction = (data >> 1) & 0x07;
      const secondActionValid = (data & 0x01) !== 0;
      if (firstAction > 3 || (secondActionValid && secondAction > 3)) {
        return { kind: 'ignored' };
      }
      state = {
        messageType: 'N',
        pressed,
        buttons: secondActionValid
          ? [buttons[firstAction], buttons[secondAction]]
          : [buttons[firstAction]],
      };
    } else {
      if ((data & 0x0f) !== 0 || (firstAction !== 0 && firstAction !== 3)) {
        return { kind: 'ignored' };
      }
      state = { messageType: 'U', pressed, buttonCount: firstAction === 0 ? 0 : '3_or_4' };
    }
    return {
      kind: 'reported',
      value: state,
      reportedState: state,
      clearDesiredState: true,
    };
  },

  parseCommand: readOnly,
  encodeCommand: readOnly,
};
