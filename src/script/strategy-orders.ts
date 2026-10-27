import type { Series } from "../core/series.js";
import type { Direction, StrategyEngine } from "../strategy/index.js";
import type { ScriptApi } from "./index.js";

/** A condition: a plain boolean or a boolean series (its current bar is read). */
export type Condition = boolean | Series<boolean>;

export interface EntryOptions {
  /** Defaults to the declaration's `default_qty_value` when `default_qty_type` is `"fixed"`. */
  readonly qty?: number;
  readonly limit?: number;
  readonly stop?: number;
  readonly oca_name?: string;
  /** The order is placed only on bars where this is true. Omitted means always. */
  readonly when?: Condition;
}

export interface CloseOptions {
  readonly qty?: number;
  readonly when?: Condition;
}

export interface WhenOptions {
  readonly when?: Condition;
}

export interface ExitOptions {
  /** Entry id the bracket protects. */
  readonly from_entry: string;
  /** Omitted exits the whole trade. */
  readonly qty?: number;
  /** Take-profit price. */
  readonly limit?: number;
  /** Stop-loss price. */
  readonly stop?: number;
  /** Take-profit distance in ticks from the entry price (needs `mintick`). */
  readonly profit?: number;
  /** Stop-loss distance in ticks from the entry price (needs `mintick`). */
  readonly loss?: number;
  readonly oca_name?: string;
  readonly when?: Condition;
}

/** Order helpers. Each call delegates to the `StrategyEngine` method of the same name. */
export interface StrategyOrders {
  readonly engine: StrategyEngine;
  entry(id: string, direction: Direction, options?: EntryOptions): void;
  close(id: string, options?: CloseOptions): void;
  close_all(options?: WhenOptions): void;
  cancel(id: string, options?: WhenOptions): void;
  cancel_all(options?: WhenOptions): void;
  /** Take-profit / stop-loss bracket; see `StrategyEngine.exit`. */
  exit(id: string, options: ExitOptions): void;
}

export interface StrategyApi extends ScriptApi {
  readonly strategy: StrategyOrders;
}

const isTrue = (condition: Condition | undefined): boolean => {
  if (condition === undefined) return true;
  if (typeof condition === "boolean") return condition;
  if (typeof condition === "object" && typeof condition.at === "function") {
    const value: unknown = condition.at(0);
    // A v6 bool is never na: a missing value reads as false.
    if (value === undefined || typeof value === "boolean") return value === true;
  }
  throw new TypeError(
    `Order condition must be a boolean or boolean series; got ${typeof condition}`,
  );
};

const defaultQty = (engine: StrategyEngine): number => {
  const { default_qty_type: type = "fixed", default_qty_value: value } = engine.config;
  if (type !== "fixed" || value === undefined) {
    throw new Error(
      `strategy.entry() needs an explicit qty when default_qty_type is "${type}"; only "fixed" sizing is resolved automatically`,
    );
  }
  return value;
};

export const createOrders = (engine: StrategyEngine): StrategyOrders => ({
  engine,
  entry: (id, direction, { qty, limit, stop, oca_name: ocaName, when } = {}) => {
    if (!isTrue(when)) return;
    engine.entry(id, direction, qty ?? defaultQty(engine), {
      ...(limit === undefined ? {} : { limit }),
      ...(stop === undefined ? {} : { stop }),
      ...(ocaName === undefined ? {} : { ocaName }),
    });
  },
  close: (id, { qty, when } = {}) => {
    if (isTrue(when)) engine.close(id, qty);
  },
  close_all: ({ when } = {}) => {
    if (isTrue(when)) engine.close_all();
  },
  cancel: (id, { when } = {}) => {
    if (isTrue(when)) engine.cancel(id);
  },
  exit: (
    id,
    { from_entry: fromEntry, qty, limit, stop, profit, loss, oca_name: ocaName, when },
  ) => {
    if (!isTrue(when)) return;
    engine.exit(id, fromEntry, qty, {
      ...(limit === undefined ? {} : { limit }),
      ...(stop === undefined ? {} : { stop }),
      ...(profit === undefined ? {} : { profit }),
      ...(loss === undefined ? {} : { loss }),
      ...(ocaName === undefined ? {} : { ocaName }),
    });
  },
  cancel_all: ({ when } = {}) => {
    if (isTrue(when)) engine.cancel_all();
  },
});
