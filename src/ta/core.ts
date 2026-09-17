import { incrementalEma, incrementalSma } from "../core/indicator-cache.js";
import type { Series } from "../core/series.js";

const requirePositiveLength = (length: number): void => {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
};

export const sma = (source: Series<number>, length: number): number | undefined =>
  incrementalSma(source, length);

export const ema = (source: Series<number>, length: number): number | undefined =>
  incrementalEma(source, length);

export const highest = (source: Series<number>, length: number): number | undefined => {
  requirePositiveLength(length);
  if (source.length < length) {
    return undefined;
  }

  let result = -Infinity;
  for (let index = source.length - length; index < source.length; index += 1) {
    const value = source.get(index);
    if (value !== undefined) {
      result = Math.max(result, value);
    }
  }
  return result;
};

export const lowest = (source: Series<number>, length: number): number | undefined => {
  requirePositiveLength(length);
  if (source.length < length) {
    return undefined;
  }

  let result = Infinity;
  for (let index = source.length - length; index < source.length; index += 1) {
    const value = source.get(index);
    if (value !== undefined) {
      result = Math.min(result, value);
    }
  }
  return result;
};

export const change = (source: Series<number>, length = 1): number | undefined => {
  requirePositiveLength(length);
  const current = source.current;
  const previous = source.at(length);
  return current === undefined || previous === undefined ? undefined : current - previous;
};

export const crossover = (source: Series<number>, other: Series<number>): boolean => {
  const currentSource = source.current;
  const currentOther = other.current;
  const previousSource = source.at(1);
  const previousOther = other.at(1);

  return (
    currentSource !== undefined &&
    currentOther !== undefined &&
    previousSource !== undefined &&
    previousOther !== undefined &&
    currentSource > currentOther &&
    previousSource <= previousOther
  );
};

export const crossunder = (source: Series<number>, other: Series<number>): boolean => {
  const currentSource = source.current;
  const currentOther = other.current;
  const previousSource = source.at(1);
  const previousOther = other.at(1);

  return (
    currentSource !== undefined &&
    currentOther !== undefined &&
    previousSource !== undefined &&
    previousOther !== undefined &&
    currentSource < currentOther &&
    previousSource >= previousOther
  );
};
