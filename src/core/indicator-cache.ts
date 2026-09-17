import type { Series } from "./series.js";

interface EmaState { processed: number; value?: number; }
interface SmaState { processed: number; queue: number[]; sum: number; }
const emaStates = new WeakMap<object, Map<number, EmaState>>();
const smaStates = new WeakMap<object, Map<number, SmaState>>();
const trackedSources = new Set<object>();

function requireLength(length: number): void {
  if (!Number.isInteger(length) || length <= 0) throw new RangeError("length must be a positive integer");
}

export function invalidateIndicatorState(source: Series<number>): void {
  emaStates.delete(source as object);
  smaStates.delete(source as object);
}

export function invalidateAllIndicatorState(): void {
  for (const source of trackedSources) invalidateIndicatorState(source as Series<number>);
  trackedSources.clear();
}

export function incrementalEma(source: Series<number>, length: number): number | undefined {
  requireLength(length); trackedSources.add(source as object);
  let states = emaStates.get(source as object);
  if (!states) { states = new Map(); emaStates.set(source as object, states); }
  let state = states.get(length);
  if (!state) { state = { processed: 0 }; states.set(length, state); }
  const alpha = 2 / (length + 1);
  while (state.processed < source.length) {
    const value = source.get(state.processed++);
    if (value === undefined) continue;
    if (state.value === undefined) {
      if (state.processed < length) continue;
      let sum = 0;
      for (let i = state.processed - length; i < state.processed; i += 1) {
        const item = source.get(i); if (item === undefined) return undefined; sum += item;
      }
      state.value = sum / length;
    } else state.value = alpha * value + (1 - alpha) * state.value;
  }
  return state.value;
}

export function incrementalSma(source: Series<number>, length: number): number | undefined {
  requireLength(length); trackedSources.add(source as object);
  let states = smaStates.get(source as object);
  if (!states) { states = new Map(); smaStates.set(source as object, states); }
  let state = states.get(length);
  if (!state) { state = { processed: 0, queue: [], sum: 0 }; states.set(length, state); }
  while (state.processed < source.length) {
    const value = source.get(state.processed++);
    if (value === undefined) { state.queue.length = 0; state.sum = 0; continue; }
    state.queue.push(value); state.sum += value;
    if (state.queue.length > length) state.sum -= state.queue.shift()!;
  }
  return state.queue.length === length ? state.sum / length : undefined;
}
