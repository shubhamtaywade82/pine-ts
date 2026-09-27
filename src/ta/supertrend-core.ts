import { isNa } from "../core/na.js";
import { nodeKey } from "../core/node-registry.js";
import { IndicatorNode } from "../core/series-node.js";
import type { PineSession } from "../core/session.js";
import { FloatSeries, Series } from "../core/series.js";

export interface SupertrendResult {
  readonly supertrend: FloatSeries;
  readonly direction: Series<number>;
}

interface SupertrendBar {
  readonly upper: number;
  readonly lower: number;
  readonly line: number;
  readonly direction: number;
}

interface SupertrendState {
  /** The last committed bar, i.e. `upperBand[1]`, `lowerBand[1]`, `superTrend[1]`. */
  previous: SupertrendBar | undefined;
}

const nz = (value: number | undefined): number => (value === undefined || isNa(value) ? 0 : value);

/**
 * SuperTrend over an arbitrary ATR-like series — a literal transcription of
 * the v6 reference `pine_supertrend(factor, atr)`:
 *
 * ```pine
 * upperBand = hl2 + factor * atr
 * lowerBand = hl2 - factor * atr
 * prevLowerBand = nz(lowerBand[1])
 * prevUpperBand = nz(upperBand[1])
 * lowerBand := lowerBand > prevLowerBand or close[1] < prevLowerBand ? lowerBand : prevLowerBand
 * upperBand := upperBand < prevUpperBand or close[1] > prevUpperBand ? upperBand : prevUpperBand
 * if na(atr[1])
 *     _direction := 1
 * else if prevSuperTrend == prevUpperBand
 *     _direction := close > upperBand ? -1 : 1
 * else
 *     _direction := close < lowerBand ? 1 : -1
 * superTrend := _direction == -1 ? lowerBand : upperBand
 * ```
 *
 * Comparisons with na are false, as in Pine, so a na `atr` bar carries the
 * previous bands (or resets them through `nz`) exactly like the transcription.
 * `ta.supertrend` passes `ta.atr(atrPeriod)`; community scripts pass their own
 * volatility estimate. `name` prefixes the node keys.
 *
 * `lineWhileAtrNa` selects the line on bars whose `atr` is na:
 * - `"na"` — the built-in `ta.supertrend` behavior during warm-up;
 * - `"transcription"` — whatever the Pine code above yields (for example 0 on
 *   the first bar, where `close[1]` is na), which scripts that define their own
 *   `pine_supertrend` produce on TradingView.
 */
export const supertrendOver = (
  runtime: PineSession,
  factor: number,
  atrSeries: Series<number>,
  name: string,
  lineWhileAtrNa: "na" | "transcription",
): SupertrendResult => {
  if (!Number.isFinite(factor)) {
    throw new RangeError("factor must be a finite number");
  }
  if (atrSeries.runtime !== runtime) {
    throw new Error("SuperTrend operands must belong to the same PineSession");
  }
  const { close, hl2 } = runtime.sources;

  const bars = runtime.nodes.getOrCreate(
    nodeKey(`${name}:factor=${factor}:line=${lineWhileAtrNa}`, atrSeries, hl2, close),
    () => {
      const evaluate = (state: Readonly<SupertrendState>): SupertrendBar => {
        const volatility = atrSeries.at(0) ?? Number.NaN;
        const source = hl2.at(0) ?? Number.NaN;
        const closeNow = close.at(0) ?? Number.NaN;
        const closePrevious = close.at(1) ?? Number.NaN;
        const previous = state.previous;
        const previousLower = nz(previous?.lower);
        const previousUpper = nz(previous?.upper);

        const rawUpper = source + factor * volatility;
        const rawLower = source - factor * volatility;
        const lower =
          rawLower > previousLower || closePrevious < previousLower ? rawLower : previousLower;
        const upper =
          rawUpper < previousUpper || closePrevious > previousUpper ? rawUpper : previousUpper;

        let direction: number;
        if (isNa(atrSeries.at(1) ?? Number.NaN)) direction = 1;
        else if (previous?.line === previousUpper) direction = closeNow > upper ? -1 : 1;
        else direction = closeNow < lower ? 1 : -1;

        const tracked = direction === -1 ? lower : upper;
        const line = lineWhileAtrNa === "na" && isNa(volatility) ? Number.NaN : tracked;
        return { upper, lower, line, direction };
      };
      return new Series<SupertrendBar>(
        runtime,
        new IndicatorNode<SupertrendState, SupertrendBar>({
          init: () => ({ previous: undefined }),
          evaluate,
          commit: (state) => {
            state.previous = evaluate(state);
          },
        }),
      );
    },
  );

  const supertrend = runtime.nodes.getOrCreate(nodeKey(`${name}.line`, bars), () => {
    const evaluate = (): number => bars.at(0)?.line ?? Number.NaN;
    return new FloatSeries(
      runtime,
      new IndicatorNode({ init: (): null => null, evaluate, commit: (): void => undefined }),
    );
  }) as FloatSeries;

  const direction = runtime.nodes.getOrCreate(nodeKey(`${name}.direction`, bars), () => {
    const evaluate = (): number => bars.at(0)?.direction ?? 1;
    return new Series<number>(
      runtime,
      new IndicatorNode({ init: (): null => null, evaluate, commit: (): void => undefined }),
    );
  });

  return { supertrend, direction };
};
