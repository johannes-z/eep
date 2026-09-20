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
  off: { kind: 'power', d2Value: 0 },
  level1: { kind: 'speed', d2Value: 1 },
  level2: { kind: 'speed', d2Value: 2 },
  level3: { kind: 'speed', d2Value: 3 },
  level4: { kind: 'speed', d2Value: 4 },
  automatic: { kind: 'preset', d2Value: 11, preset: 'Automatic' },
  automaticOnDemand: { kind: 'preset', d2Value: 12, preset: 'Automatic on demand' },
  supplyOnly: { kind: 'preset', d2Value: 13, preset: 'Supply' },
  exhaustOnly: { kind: 'preset', d2Value: 14, preset: 'Exhaust' },
} as const satisfies Record<string, ProtocolFunctionDefinition>;

export const DEFAULT_SUPPORTED_FUNCTIONS = [
  'off',
  'level1',
  'level2',
  'level3',
  'level4',
  'automatic',
  'supplyOnly',
  'exhaustOnly',
] as const;

export function getProtocolFunctions(): Readonly<Record<string, ProtocolFunctionDefinition>> {
  return PROTOCOL_FUNCTIONS;
}

export function getDefaultSupportedFunctions(): string[] {
  return [...DEFAULT_SUPPORTED_FUNCTIONS];
}

export function getSupportedProtocolFunctions(
  supportedFunctions: readonly string[],
): ResolvedProtocolFunction[] {
  const supported = new Set(supportedFunctions);
  return Object.entries(PROTOCOL_FUNCTIONS)
    .filter(([id]) => supported.has(id))
    .map(([id, definition]) => ({ id, ...definition }));
}

export function getProtocolFunctionByValue(value: number): ResolvedProtocolFunction | undefined {
  const match = Object.entries(PROTOCOL_FUNCTIONS).find(
    ([, definition]) => definition.d2Value === value,
  );
  return match ? { id: match[0], ...match[1] } : undefined;
}
