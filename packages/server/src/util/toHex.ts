export function toHex(value: number): number[] {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`Expected an unsigned 32-bit ID, received ${value}`);
  }

  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 0xff);
}
