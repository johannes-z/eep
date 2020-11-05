export function toHex (value: number): number[] {
  return value.toString(16)
    .match(/(..?)/g)!
    .map(v => parseInt(v, 16))
}
