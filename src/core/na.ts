/** Numeric representation of Pine's `na`. */
export const na = Number.NaN;

export type PineValue<T> = T | undefined;

export const isNa = (value: unknown): boolean =>
  value === undefined || (typeof value === "number" && Number.isNaN(value));

export const nz = (value: number | undefined, replacement = 0): number =>
  isNa(value) ? replacement : value;
