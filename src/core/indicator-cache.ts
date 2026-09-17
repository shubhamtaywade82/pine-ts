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

function requireLength(length: number): void {
  if (!Number.isInteger(length) || length <= 0) throw new RangeError("length must be a positive integer");
}

/** Incremental Pine-style EMA evaluator. Only newly committed observations are processed. */
export function incrementalEma(source: Series<number>, length: number): number | undefined {
  requireLength(length);
  let states = emaStates.get(source as object);
  if (!states) {
    states = new Map();
    emaStates.set(source as object, states);
  }
  let state = states.get(length);
  if (!state) {
    state = { processed: 0 };
    states.set(length, state);
  }

  const alpha = 2 / (length + 1);
  while (state.processed < source.length) {
    const value = source.get(state.processed++);
    if (value === undefined) continue;
    if (state.value === undefined) {
      // Pine's standard EMA seeds from the SMA of the first `length` values.
      const count = state.processed;
      if (count < length) continue;
      let sum = 0;
      let valid = true;
      for (let i = count - length; i < count; i += 1) {
        const item = source.get(i);
        if (item === undefined) { valid = false; break; }
        sum += item;
      }
      if (valid) state.value = sum / length;
    } else {
      state.value = alpha * value + (1 - alpha) * state.value;
    }
  }
  return state.value;
}

/** Incremental rolling SMA evaluator. */
export function incrementalSma(source: Series<number>, length: number): number | undefined {
  requireLength(length);
  let states = smaStates.get(source as object);
  if (!states) {
    states = new Map();
    smaStates.set(source as object, states);
  }
  let state = states.get(length);
  if (!state) {
    state = { processed: 0, queue: [], sum: 0 };
    states.set(length, state);
  }

  while (state.processed < source.length) {
    const value = source.get(state.processed++);
    if (value === undefined) {
      state.queue.length = 0;
      state.sum = 0;
      continue;
    }
    state.queue.push(value);
    state.sum += value;
    if (state.queue.length > length) state.sum -= state.queue.shift()!;
  }

  return state.queue.length === length ? state.sum / length : undefined;
}
