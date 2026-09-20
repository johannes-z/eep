export function parseEnOceanId(value: unknown): number | undefined {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 && value <= 0xffffffff ? value : undefined;
  }
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim();
  if (!/^(?:0x)?[0-9a-f]{1,8}$/i.test(normalized)) return undefined;
  return Number.parseInt(normalized.replace(/^0x/i, ''), 16);
}

export function formatEnOceanId(value: number): string {
  return requireEnOceanId(value, 'EnOcean identifier').toString(16).padStart(8, '0');
}

export function requireEnOceanId(value: unknown, field: string, minimum = 0): number {
  const parsed = parseEnOceanId(value);
  if (parsed === undefined || parsed < minimum) {
    throw new Error(`Invalid ${field}`);
  }
  return parsed;
}
