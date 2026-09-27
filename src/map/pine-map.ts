import { getCurrentSession } from "../core/execution-context.js";

/**
 * The maximum number of *elements* any Pine map may hold. Because every
 * key-value pair consists of two elements (the unique key and its value),
 * a map can contain at most 50,000 pairs — the bound the v6 Maps page
 * documents alongside the shared 100,000-element collection cap.
 */
export const MAX_MAP_ELEMENTS = 100_000;
/** The maximum number of key-value pairs any Pine map may hold. */
export const MAX_MAP_SIZE: number = MAX_MAP_ELEMENTS / 2;

/**
 * Backing storage owned by a root map. The insertion-ordered JS `Map` is a
 * natural fit for Pine's documented ordering: keys iterate in insertion
 * order, and re-putting an existing key replaces its value without moving
 * the pair, exactly as the v6 reference specifies.
 */
export class MapBacking<K, V> {
  public readonly data: Map<K, V | undefined> = new Map<K, V | undefined>();
  /** When true (varip promotion) mutations skip the session's undo journal. */
  public varip = false;
}

/**
 * A Pine `map<K, V>`: an insertion-ordered collection of unique key-value
 * pairs whose in-place mutations are journaled on the owning session so
 * realtime revisions roll them back — the map counterpart of a `var` cell
 * restoring its committed value. Maps are root-only (no slice views); every
 * derived collection (`map.copy`, `map.keys`, `map.values`) is a fresh
 * shallow copy whose later mutations journal independently.
 *
 * Keys are Pine *value* types (int/float/bool/string/color/enum). The JS
 * `Map` keying (SameValueZero) matches Pine's observed equality: `0` and
 * `-0` are one key, and a numeric `na` key (`NaN`) is distinct from every
 * other key while remaining retrievable.
 */
export class PineMap<K, V> {
  public readonly backing: MapBacking<K, V>;

  public constructor(backing: MapBacking<K, V> = new MapBacking<K, V>()) {
    this.backing = backing;
  }

  /**
   * `varip` promotion: mutations stop journaling (and already-journaled
   * mutations become permanent), so updates finalize on every tick. Pine
   * forbids collections as direct map values, so — unlike arrays — there
   * is no nested promotion to walk.
   */
  public _setVarip(enabled: boolean): void {
    this.backing.varip = enabled;
    if (!enabled) return;
    const session = getCurrentSession();
    if (session !== undefined) session.purgeArrayMutations(this.backing);
  }

  /** Current pair count. */
  public size(): number {
    return this.backing.data.size;
  }

  /**
   * The value stored under `key`, or `undefined` (Pine `na`) when the key
   * is absent. A numeric `na` value stored earlier reads back as `NaN`,
   * which — exactly as on TradingView — is indistinguishable from `na`.
   */
  public get(key: K): V | undefined {
    return this.backing.data.get(key);
  }

  /**
   * Puts `key` → `value`, returning the previous value (`undefined`/Pine
   * `na` when the key is new). Re-putting an existing key replaces the
   * value but keeps the pair's original insertion-order slot.
   */
  public put(key: K, value: V | undefined): V | undefined {
    const existed = this.backing.data.has(key);
    const previous = this.backing.data.get(key);
    if (!existed && this.backing.data.size >= MAX_MAP_SIZE) {
      throw new RangeError(`Map is too large. Maximum size is ${MAX_MAP_SIZE}`);
    }
    this.journal(() => {
      if (existed) this.backing.data.set(key, previous);
      else this.backing.data.delete(key);
    });
    this.backing.data.set(key, value);
    return previous;
  }

  /** Removes `key`, returning its previous value (`na` when absent). */
  public remove(key: K): V | undefined {
    if (!this.backing.data.has(key)) return undefined;
    const previous = this.backing.data.get(key);
    this.journal(() => {
      this.backing.data.set(key, previous);
    });
    this.backing.data.delete(key);
    return previous;
  }

  /** True when `key` is present. */
  public has(key: K): boolean {
    return this.backing.data.has(key);
  }

  /** Removes every pair (journaled, so realtime revisions restore them). */
  public clear(): void {
    if (this.backing.data.size === 0) return;
    const restored = [...this.backing.data.entries()] as [K, V | undefined][];
    this.journal(() => {
      this.backing.data.clear();
      for (const [key, value] of restored) this.backing.data.set(key, value);
    });
    this.backing.data.clear();
  }

  /** Snapshots the keys in insertion order (used by `map.keys`). */
  public keys(): (K | undefined)[] {
    return [...this.backing.data.keys()];
  }

  /** Snapshots the values in insertion order (used by `map.values`). */
  public values(): (V | undefined)[] {
    return [...this.backing.data.values()];
  }

  /** Iterates `[key, value]` pairs in insertion order. */
  public entries(): [K, V | undefined][] {
    return [...this.backing.data.entries()] as [K, V | undefined][];
  }

  private journal(undo: () => void): void {
    const session = getCurrentSession();
    if (session === undefined || this.backing.varip) return;
    session.journalArrayMutation(this.backing, undo);
  }
}
