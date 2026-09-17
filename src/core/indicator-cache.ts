import type { Series } from "./series.js";

interface EmaState {
  processed: number;
  value?: number;
}

interface SmaState {
  processed: number;
  queue: number[];
  sum: number;
}

const emaStates = new WeakMap<object, Map<number, EmaState>>();
const smaStates = new WeakMap<object, Map<number, SmaState>>();

const requireLength = (length: number): void => {
  if (!Number.isInteger(length) || length <= 0) {
    throw new RangeError("length must be a positive integer");
  }
};

const getStateMap = <State>(cache: WeakMap<object, Map<number, State>>, source: object) => {
  let states = cache.get(source);
  if (states === undefined) {
    states = new Map();
    cache.set(source, states);
  }
  return states;
};

const getState = <State>(
  states: Map<number, State>,
  length: number,
  create: () => State,
): State => {
  let state = states.get(length);
  if (state === undefined) {
    state = create();
    states.set(length, state);
  }
  return state;
};

const seedEma = (source: Series<number>, length: number, processed: number): number | undefined => {
  if (processed < length) return undefined;

  let sum = 0;
  for (let index = processed - length; index < processed; index += 1) {
    const item = source.get(index);
    if (item === undefined) return undefined;
    sum += item;
  }
  return sum / length;
};

export const invalidateIndicatorState = (source: Series<number>): void => {
  emaStates.delete(source);
  smaStates.delete(source);
};

export const incrementalEma = (source: Series<number>, length: number): number | undefined => {
  requireLength(length);

  const states = getStateMap(emaStates, source);
  const state = getState(states, length, () => ({ processed: 0 }));
  const alpha = 2 / (length + 1);

  while (state.processed < source.length) {
    const value = source.get(state.processed++);
    if (value === undefined) continue;

    if (state.value === undefined) {
      state.value = seedEma(source, length, state.processed);
    } else {
      state.value = alpha * value + (1 - alpha) * state.value;
    }
  }

  return state.value;
};

export const incrementalSma = (source: Series<number>, length: number): number | undefined => {
  requireLength(length);

  const states = getStateMap(smaStates, source);
  const state = getState(states, length, () => ({ processed: 0, queue: [], sum: 0 }));

  while (state.processed < source.length) {
    const value = source.get(state.processed++);
    if (value === undefined) {
      state.queue.length = 0;
      state.sum = 0;
      continue;
    }

    state.queue.push(value);
    state.sum += value;
    if (state.queue.length > length) {
      const oldestValue = state.queue.shift();
      if (oldestValue !== undefined) {
        state.sum -= oldestValue;
      }
    }
  }

  return state.queue.length === length ? state.sum / length : undefined;
};
