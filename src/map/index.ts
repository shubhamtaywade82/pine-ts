import type { PineArray } from "../array/pine-array.js";
import { PineMap } from "./pine-map.js";

export { PineMap } from "./pine-map.js";

/** Creates a new Pine Script map. */
export const new_map = <K, V>(): PineMap<K, V> => new PineMap<K, V>();

/** Associates the specified value with the specified key in the map. */
export const put = <K, V>(id: PineMap<K, V>, key: K, value: V): void => {
  id.put(key, value);
};

/** Returns the value associated with the specified key, or undefined if not present. */
export const get = <K, V>(id: PineMap<K, V>, key: K): V | undefined => id.get(key);

/** Returns true if the map contains a mapping for the specified key. */
export const contains = <K, V>(id: PineMap<K, V>, key: K): boolean => id.contains(key);

/** Removes the mapping for a key from this map if it is present. */
export const remove = <K, V>(id: PineMap<K, V>, key: K): V | undefined => id.remove(key);

/** Removes all mappings from the map. */
export const clear = <K, V>(id: PineMap<K, V>): void => {
  id.clear();
};

/** Returns the number of key-value mappings in the map. */
export const size = <K, V>(id: PineMap<K, V>): number => id.size();

/** Returns a shallow copy of the map. */
export const copy = <K, V>(id: PineMap<K, V>): PineMap<K, V> => id.copy();

/** Copies all mappings from id2 into id1. */
export const put_all = <K, V>(id1: PineMap<K, V>, id2: PineMap<K, V>): void => {
  id1.put_all(id2);
};

/** Returns an array containing all keys from the map. */
export const keys = <K, V>(id: PineMap<K, V>): PineArray<K> => id.keys();

/** Returns an array containing all values from the map. */
export const values = <K, V>(id: PineMap<K, V>): PineArray<V> => id.values();
