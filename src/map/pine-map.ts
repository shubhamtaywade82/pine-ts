import { PineArray } from "../array/pine-array.js";

/**
 * Pine Script v6 Map collection with realtime rollback support.
 */
export class PineMap<K, V> {
  private entries: Map<K, V>;
  private committed: Map<K, V>;

  public constructor(initialEntries?: ReadonlyMap<K, V>) {
    this.entries = initialEntries ? new Map<K, V>(initialEntries) : new Map<K, V>();
    this.committed = initialEntries ? new Map<K, V>(initialEntries) : new Map<K, V>();
  }

  public put(key: K, value: V): void {
    this.entries.set(key, value);
  }

  public get(key: K): V | undefined {
    return this.entries.get(key);
  }

  public contains(key: K): boolean {
    return this.entries.has(key);
  }

  public remove(key: K): V | undefined {
    const val = this.entries.get(key);
    this.entries.delete(key);
    return val;
  }

  public clear(): void {
    this.entries.clear();
  }

  public size(): number {
    return this.entries.size;
  }

  public copy(): PineMap<K, V> {
    return new PineMap<K, V>(this.entries);
  }

  public put_all(other: PineMap<K, V>): void {
    for (const [k, v] of other.entries) {
      this.entries.set(k, v);
    }
  }

  public keys(): PineArray<K> {
    return new PineArray<K>([...this.entries.keys()]);
  }

  public values(): PineArray<V> {
    return new PineArray<V>([...this.entries.values()]);
  }

  public _commit(): void {
    this.committed = new Map<K, V>(this.entries);
  }

  public _rollback(): void {
    this.entries = new Map<K, V>(this.committed);
  }
}
