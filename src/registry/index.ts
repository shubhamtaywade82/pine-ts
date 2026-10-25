/**
 * Pine-ts indicator registry namespace.
 *
 * Re-exports everything needed to author, register, list, instantiate, and
 * run indicators. See `types.ts` for the contract and `define.ts` for the
 * factory helpers (`intInput`, `linePlot`, `defineIndicator`, ...).
 *
 * Usage:
 *
 * ```ts
 * import { registry, indicators } from "pine-ts";
 *
 * // Self-register the 6 built-in indicators (sma, ema, rsi, macd, bb, obv).
 * import "pine-ts/registry/indicators";
 *
 * // List all registered indicators.
 * for (const meta of registry.list()) {
 *   console.log(meta.id, meta.name, meta.category);
 * }
 *
 * // Instantiate + run RSI(14) across a bar array.
 * const instance = registry.instantiate("rsi", { length: 14 })!;
 * for await (const result of instance.run(bars)) {
 *   console.log(result.main); // the RSI value at each bar
 * }
 * ```
 */

export * from "./types.js";
export * from "./define.js";
export * from "./helpers.js";
export * from "./registry.js";
