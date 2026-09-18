/** Numeric representation of Pine's `na`. */
export const na: number = Number.NaN;

export type PineValue<T> = T | undefined;

export function isNa(value: number | undefined): value is undefined;
export function isNa(value: unknown): boolean;
export function isNa(value: unknown): boolean {
  return value === undefined || (typeof value === "number" && Number.isNaN(value));
}

export const nz = (value: number | undefined, replacement = 0): number =>
  isNa(value) ? replacement : value;
