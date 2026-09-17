import type { Series } from "../core/series.js";

function requireLength(length: number): void {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
}

export function sma(source: Series<number>, length: number): number | undefined {
  requireLength(length);
  if (source.length < length) return undefined;
  let sum = 0;
  for (let i = source.length - length; i < source.length; i += 1) sum += source.get(i)!;
  return sum / length;
}

export function ema(source: Series<number>, length: number): number | undefined {
  requireLength(length);
  if (source.length < length) return undefined;

  const seedStart = source.length - 1;
  let result = source.get(seedStart - length + 1)!;
  let seedSum = 0;
  for (let i = seedStart - length + 1; i <= seedStart; i += 1) seedSum += source.get(i)!;
  result = seedSum / length;

  const alpha = 2 / (length + 1);
  for (let i = seedStart + 1; i < source.length; i += 1) {
    result = alpha * source.get(i)! + (1 - alpha) * result;
  }
  return result;
}

export function highest(source: Series<number>, length: number): number | undefined {
  requireLength(length);
  if (source.length < length) return undefined;
  let result = -Infinity;
  for (let i = source.length - length; i < source.length; i += 1) result = Math.max(result, source.get(i)!);
  return result;
}

export function lowest(source: Series<number>, length: number): number | undefined {
  requireLength(length);
  if (source.length < length) return undefined;
  let result = Infinity;
  for (let i = source.length - length; i < source.length; i += 1) result = Math.min(result, source.get(i)!);
  return result;
}

export function change(source: Series<number>, length = 1): number | undefined {
  if (!Number.isInteger(length) || length < 1) throw new RangeError("length must be a positive integer");
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
