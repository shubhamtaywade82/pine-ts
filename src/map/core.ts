import { PineArray } from "../array/pine-array.js";
import { PineMap } from "./pine-map.js";

/** v6 `map.new<keyType, valueType>()` — an empty insertion-ordered map. */
export const newMap = <K, V>(): PineMap<K, V> => new PineMap<K, V>();

/**
 * v6 `map.copy(id)` — a shallow copy: a fresh map whose pairs (and value
 * references) mirror `id` at copy time. Later mutations of either map do
 * not affect the other, exactly as the reference's example demonstrates.
 */
export const copy = <K, V>(id: PineMap<K, V>): PineMap<K, V> => {
  const duplicate = new PineMap<K, V>();
  for (const [key, value] of id.entries()) duplicate.backing.data.set(key, value);
  return duplicate;
};

/**
 * v6 `map.put(id, key, value)` — returns the previous value associated
 * with `key`, or `na` if the key is new.
 */
export const put = <K, V>(id: PineMap<K, V>, key: K, value: V | undefined): V | undefined =>
  id.put(key, value);

/** v6 `map.get(id, key)` — the value under `key`, or `na` when absent. */
export const get = <K, V>(id: PineMap<K, V>, key: K): V | undefined => id.get(key);

/** v6 `map.contains(id, key)` — whether `key` is present. */
export const contains = <K, V>(id: PineMap<K, V>, key: K): boolean => id.has(key);

/**
 * v6 `map.remove(id, key)` — removes the pair and returns its previous
 * value, or `na` when the key was not found.
 */
export const remove = <K, V>(id: PineMap<K, V>, key: K): V | undefined => id.remove(key);

/** v6 `map.size(id)` — the number of key-value pairs. */
export const size = <K, V>(id: PineMap<K, V>): number => id.size();

/** v6 `map.clear(id)` — removes all pairs. */
export const clear = <K, V>(id: PineMap<K, V>): void => {
  id.clear();
};

/**
 * v6 `map.keys(id)` — a *copy* of the keys as an `array<keyType>`, in
 * insertion order. Mutating the returned array never touches the map.
 */
export const keys = <K, V>(id: PineMap<K, V>): PineArray<K> => PineArray.createRoot<K>(id.keys());

/**
 * v6 `map.values(id)` — a *copy* of the values as an `array<valueType>`,
 * in insertion order. Mutating the returned array never touches the map.
 */
export const values = <K, V>(id: PineMap<K, V>): PineArray<V> =>
  PineArray.createRoot<V>(id.values());

/**
 * v6 `map.put_all(id, id2)` — puts every pair of `id2` into `id`. New
 * keys append in `id2`'s insertion order; keys already in `id` keep their
 * original position and take `id2`'s value, per the map ordering rules.
 */
export const put_all = <K, V>(id: PineMap<K, V>, id2: PineMap<K, V>): void => {
  for (const [key, value] of id2.entries()) id.put(key, value);
};
