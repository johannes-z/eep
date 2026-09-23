export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export interface ProfileMetadata {
  readonly id: string;
  readonly rorg: number;
  readonly description: string;
}

export interface ProfilePacket {
  readonly RORG: number;
  readonly payload: ArrayLike<number>;
  readonly senderId: string | number;
  readonly status?: number;
  readonly teachIn?: boolean;
  readonly teachInInfo?: unknown;
}

export interface ProfileDeviceContext {
  readonly sourceId: number;
  readonly targetId: number;
  readonly capabilities: unknown;
  readonly reportedState?: unknown;
  readonly desiredState?: unknown;
}

export type ProfileStateField = 'reportedState' | 'desiredState';

export type ProfileIngressResult =
  | { readonly kind: 'ignored' }
  | {
      readonly kind: 'reported';
      readonly value?: JsonValue;
      readonly reportedState: unknown;
      readonly clearDesiredState: boolean;
    };

export interface ProfileCommand {
  readonly value: unknown;
  readonly desiredState?: unknown;
}

export type ProfileEntityContext = ProfileDeviceContext;

export interface ProfileEntityDescriptor {
  readonly kind: string;
  readonly deviceClass?: string;
  readonly jsonState?: boolean;
  readonly discoveryEntities?: readonly {
    readonly key: string;
    readonly name: string | null;
    readonly kind?: 'sensor' | 'binary_sensor' | 'number' | 'switch' | 'select' | 'button';
    readonly valueTemplate?: string;
    readonly commandTemplate?: string;
    readonly options?: readonly (string | number)[];
    readonly deviceClass?: string;
    readonly unit?: string;
    readonly stateClass?: 'measurement';
    readonly entityCategory?: 'diagnostic';
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
  }[];
  readonly publishInitialState?: boolean;
  readonly protocol: string;
  readonly power: boolean;
  readonly commands: readonly string[];
  readonly percentage?: { readonly min: number; readonly max: number };
  readonly presets?: readonly string[];
  readonly temperature?: { readonly min: number; readonly max: number; readonly step: number };
  readonly controls?: readonly {
    readonly field: string;
    readonly label: string;
    readonly kind: 'number' | 'select' | 'boolean' | 'action';
    readonly stateKey?: string;
    readonly min?: number;
    readonly max?: number;
    readonly step?: number;
    readonly nullable?: boolean;
    readonly options?: readonly { readonly value: string | number; readonly label: string }[];
  }[];
}

export interface ProfileEntityState {
  readonly isOn: boolean;
  readonly attributes?: { readonly [key: string]: JsonValue };
  readonly percentage?: number;
  readonly preset?: string;
}

export interface ProfileEntityAdapter {
  describe(context: ProfileEntityContext): ProfileEntityDescriptor;
  projectState(context: ProfileEntityContext): ProfileEntityState;
  parseCommand(context: ProfileEntityContext, field: string, value: string): unknown;
}

export interface EepProfile {
  readonly metadata: ProfileMetadata;
  readonly entity?: ProfileEntityAdapter;
  readonly transientReportedState?: boolean;
  readonly receiveOnly?: boolean;
  readonly fourBsTeachIn?: boolean;
  readonly commandDelivery?: 'onReceive';
  replyOnReceive?(context: ProfileDeviceContext, packet: ProfilePacket): ProfileCommand | undefined;

  defaultCapabilities(): JsonValue;
  validateCapabilities(value: unknown): JsonValue;
  validateState(value: unknown, field: ProfileStateField, capabilities: unknown): unknown;
  decodeIngress(context: ProfileDeviceContext, packet: ProfilePacket): ProfileIngressResult;
  parseCommand(context: ProfileDeviceContext, request: unknown): ProfileCommand;
  encodeCommand(context: ProfileDeviceContext, command: ProfileCommand): Uint8Array;
}
