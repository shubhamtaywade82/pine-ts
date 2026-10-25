/**
 * `strategy.exit` bracket model shared by the backtest emulator and the
 * broker router, so both resolve take-profit / stop-loss prices identically.
 */

import type { Direction } from "./index.js";

/** A validated `strategy.exit` request; its side comes from the trade it protects. */
export interface ExitBracket {
  readonly id: string;
  readonly tradeId: string;
  /** `undefined` exits the whole trade. */
  readonly qty: number | undefined;
  readonly limit: number | undefined;
  readonly stop: number | undefined;
  readonly profitTicks: number | undefined;
  readonly lossTicks: number | undefined;
  readonly ocaName: string | undefined;
}

export interface BracketLevels {
  readonly takeProfit: number | undefined;
  readonly stopLoss: number | undefined;
}

/**
 * Resolves a bracket's prices for a trade entered at `entryPrice`. `profit`
 * and `loss` are ticks from the entry price. When a price and a tick distance
 * are both given for one leg, the level closer to the entry is reached first,
 * so it is the one used (Pine v6).
 */
export const resolveBracketLevels = (
  bracket: ExitBracket,
  direction: Direction,
  entryPrice: number,
  mintick: number | undefined,
): BracketLevels => {
  const sign = direction === "long" ? 1 : -1;
  const tick = mintick ?? Number.NaN;
  const fromTicks = (ticks: number | undefined, side: 1 | -1): number | undefined =>
    ticks === undefined ? undefined : entryPrice + side * sign * ticks * tick;
  const closest = (a: number | undefined, b: number | undefined): number | undefined => {
    if (a === undefined) return b;
    if (b === undefined) return a;
    return Math.abs(a - entryPrice) <= Math.abs(b - entryPrice) ? a : b;
  };
  return {
    takeProfit: closest(bracket.limit, fromTicks(bracket.profitTicks, 1)),
    stopLoss: closest(bracket.stop, fromTicks(bracket.lossTicks, -1)),
  };
};
