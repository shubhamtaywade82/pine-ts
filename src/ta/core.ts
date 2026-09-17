import type { Series } from "../core/series.js";
import { incrementalEma, incrementalSma } from "../core/indicator-cache.js";

function requirePositiveLength(length: number): void {
  if (!Number.isInteger(length) || length <= 0) throw new RangeError("length must be a positive integer");
}

export function sma(source: Series<number>, length: number): number | undefined { return incrementalSma(source, length); }
export function ema(source: Series<number>, length: number): number | undefined { return incrementalEma(source, length); }

export function highest(source: Series<number>, length: number): number | undefined {
  requirePositiveLength(length);
  if (source.length < length) return undefined;
  let result = -Infinity;
  for (let i = source.length - length; i < source.length; i += 1) result = Math.max(result, source.get(i)!);
  return result;
}

export function lowest(source: Series<number>, length: number): number | undefined {
  requirePositiveLength(length);
  if (source.length < length) return undefined;
  let result = Infinity;
  for (let i = source.length - length; i < source.length; i += 1) result = Math.min(result, source.get(i)!);
  return result;
}

export function change(source: Series<number>, length = 1): number | undefined {
  requirePositiveLength(length);
  const current = source.current;
  const previous = source.at(length);
  return current === undefined || previous === undefined ? undefined : current - previous;
}

export function crossover(source: Series<number>, other: Series<number>): boolean {
  const a = source.current, b = other.current, pa = source.at(1), pb = other.at(1);
  return a !== undefined && b !== undefined && pa !== undefined && pb !== undefined ? a > b && pa <= pb : false;
}

export function crossunder(source: Series<number>, other: Series<number>): boolean {
  const a = source.current, b = other.current, pa = source.at(1), pb = other.at(1);
  return a !== undefined && b !== undefined && pa !== undefined && pb !== undefined ? a < b && pa >= pb : false;
}
