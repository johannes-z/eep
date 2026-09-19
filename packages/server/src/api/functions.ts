export type ProtocolFunctionKind = 'power' | 'speed' | 'preset';

export interface ProtocolFunctionDefinition {
  kind: ProtocolFunctionKind;
  d2Value: number;
  preset?: string;
}

export interface ResolvedProtocolFunction extends ProtocolFunctionDefinition {
  id: string;
}

export const PROTOCOL_FUNCTIONS = {
  'D2-50-00': {
    off: { kind: 'power', d2Value: 0 },
    level1: { kind: 'speed', d2Value: 1 },
    level2: { kind: 'speed', d2Value: 2 },
    level3: { kind: 'speed', d2Value: 3 },
    level4: { kind: 'speed', d2Value: 4 },
    automatic: { kind: 'preset', d2Value: 11, preset: 'Automatic' },
    automaticOnDemand: { kind: 'preset', d2Value: 12, preset: 'Automatic on demand' },
    supplyOnly: { kind: 'preset', d2Value: 13, preset: 'Supply' },
    exhaustOnly: { kind: 'preset', d2Value: 14, preset: 'Exhaust' },
  },
} as const satisfies Record<string, Record<string, ProtocolFunctionDefinition>>;

export const DEFAULT_SUPPORTED_FUNCTIONS = {
  'D2-50-00': [
    'off',
    'level1',
    'level2',
    'level3',
    'level4',
    'automatic',
    'supplyOnly',
    'exhaustOnly',
  ],
} as const satisfies Record<string, readonly string[]>;

export function getProtocolFunctions(
  protocol: string,
): Readonly<Record<string, ProtocolFunctionDefinition>> {
  const functions = PROTOCOL_FUNCTIONS[protocol as keyof typeof PROTOCOL_FUNCTIONS];
  if (!functions) throw new Error(`Unsupported device protocol: ${protocol}`);
  return functions;
}

export function getDefaultSupportedFunctions(protocol: string): string[] {
  const configured =
    DEFAULT_SUPPORTED_FUNCTIONS[protocol as keyof typeof DEFAULT_SUPPORTED_FUNCTIONS];
  return [...(configured ?? Object.keys(getProtocolFunctions(protocol)))];
}

export function getSupportedProtocolFunctions(
  protocol: string,
  supportedFunctions: readonly string[],
): ResolvedProtocolFunction[] {
  const functions = getProtocolFunctions(protocol);
  const supported = new Set(supportedFunctions);
  return Object.entries(functions)
    .filter(([id]) => supported.has(id))
    .map(([id, definition]) => ({ id, ...definition }));
}

export function getProtocolFunctionByValue(
  protocol: string,
  value: number,
): ResolvedProtocolFunction | undefined {
  return Object.entries(getProtocolFunctions(protocol)).reduce<
    ResolvedProtocolFunction | undefined
  >(
    (match, [id, definition]) =>
      match ?? (definition.d2Value === value ? { id, ...definition } : undefined),
    undefined,
  );
}
