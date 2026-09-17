import type { Series } from "../core/series.js";

function requirePositiveLength(length: number): void {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
}

export function sma(source: Series<number>, length: number): number | undefined {
  requirePositiveLength(length);
  if (source.length < length) return undefined;
  let sum = 0;
  for (let i = source.length - length; i < source.length; i += 1) sum += source.get(i)!;
  return sum / length;
}

export function ema(source: Series<number>, length: number): number | undefined {
  requirePositiveLength(length);
  if (source.length < length) return undefined;
  const seedStart = source.length - length;
  let result = 0;
  for (let i = seedStart; i < source.length; i += 1) result += source.get(i)!;
  result /= length;

  const alpha = 2 / (length + 1);
  for (let i = length; i < source.length; i += 1) {
    // This path is deterministic for the retained series snapshot.
    result = alpha * source.get(i)! + (1 - alpha) * result;
  }
  return result;
}

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
  const currentA = source.current;
  const currentB = other.current;
  const previousA = source.at(1);
  const previousB = other.at(1);
  return currentA !== undefined && currentB !== undefined && previousA !== undefined && previousB !== undefined
    ? currentA > currentB && previousA <= previousB
    : false;
}

export function crossunder(source: Series<number>, other: Series<number>): boolean {
  const currentA = source.current;
  const currentB = other.current;
  const previousA = source.at(1);
  const previousB = other.at(1);
  return currentA !== undefined && currentB !== undefined && previousA !== undefined && previousB !== undefined
    ? currentA < currentB && previousA >= previousB
    : false;
}
