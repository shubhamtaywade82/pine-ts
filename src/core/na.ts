/** Pine's `na` value. `undefined` is used internally so TS consumers cannot accidentally treat it as a number. */
export const na: undefined = undefined;

export type PineValue<T> = T | undefined;

export function isNa<T>(value: PineValue<T>): value is undefined {
  return value === undefined;
}

export function nz(value: number | undefined, replacement = 0): number {
  return value === undefined || Number.isNaN(value) ? replacement : value;
}
