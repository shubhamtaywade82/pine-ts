/** Pine's `na` value. `undefined` is used internally so TS consumers cannot accidentally treat it as a number. */
export const na: undefined = undefined;

export type PineValue<T> = T | undefined;

export const isNa = <T>(value: PineValue<T>): value is undefined => value === undefined;

export const nz = (value: number | undefined, replacement = 0): number =>
  value === undefined || Number.isNaN(value) ? replacement : value;
