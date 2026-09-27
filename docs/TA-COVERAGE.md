# `ta.*` coverage

`api-manifest/ta.yaml` is the canonical compatibility manifest. `api-manifest/ta.v6.json` remains the machine-readable namespace inventory used by legacy inventory tooling. A manifest symbol is never considered complete merely because an export exists.

## Current implementation

| Symbol                               | Implementation | Compatibility status | Notes                                                                                |
| ------------------------------------ | -------------- | -------------------- | ------------------------------------------------------------------------------------ |
| `ta.sma`                             | yes            | verified             | incremental rolling state                                                            |
| `ta.ema`                             | yes            | verified             | incremental state, first-valid seed                                                  |
| `ta.highest`                         | yes            | verified             | rolling window                                                                       |
| `ta.lowest`                          | yes            | verified             | rolling window                                                                       |
| `ta.change`                          | yes            | verified             | Pine history semantics                                                               |
| `ta.crossover`                       | yes            | verified             | current/previous comparison                                                          |
| `ta.crossunder`                      | yes            | verified             | current/previous comparison                                                          |
| `ta.rma`                             | yes            | draft                | Wilder smoothing node                                                                |
| `ta.tr`                              | yes            | draft                | implicit OHLC source node                                                            |
| `ta.atr`                             | yes            | draft                | composed from `rma(tr(true), length)`                                                |
| `ta.wma`                             | yes            | draft                | composable finite-window weighted average                                            |
| `ta.vwma`                            | yes            | draft                | source/volume weighted window                                                        |
| `ta.swma`                            | yes            | draft                | fixed four-bar 1:2:2:1 kernel                                                        |
| `ta.hma`                             | yes            | draft                | composed from WMA nodes                                                              |
| `ta.rsi`                             | yes            | draft                | Wilder smoothing; first value on the length-th change                                |
| `ta.roc`                             | yes            | draft                | percentage rate of change                                                            |
| `ta.mom`                             | yes            | draft                | `source - source[length]`                                                            |
| `ta.stoch`                           | yes            | draft                | source against peak/valley windows                                                   |
| `ta.wpr`                             | yes            | draft                | William %R over high/low windows                                                     |
| `ta.cmo`                             | yes            | draft                | rolling gain/loss balance over the last length changes                               |
| `ta.variance`                        | yes            | draft                | biased/unbiased rolling variance                                                     |
| `ta.stdev`                           | yes            | draft                | square root of rolling variance                                                      |
| `ta.dev`                             | yes            | draft                | mean absolute deviation                                                              |
| `ta.macd`                            | yes            | draft                | `MacdResult` from EMA nodes                                                          |
| `ta.bb`                              | yes            | draft                | `BollingerBandsResult` from SMA/stdev nodes                                          |
| `ta.dmi`                             | yes            | draft                | `DmiResult` with Wilder-smoothed +DI/-DI/ADX                                         |
| `ta.supertrend`                      | yes            | draft                | `SupertrendResult` with carry-forward ATR bands                                      |
| `ta.sar`                             | yes            | draft                | literal `pine_sar` algorithm from the v6 reference                                   |
| `ta.linreg`                          | yes            | draft                | least-squares fit; `intercept + slope * (length - 1 - offset)`                       |
| `ta.bbw`                             | yes            | draft                | `(((basis + dev) - (basis - dev)) / basis) * 100` per the official re-implementation |
| `ta.kc`                              | yes            | draft                | EMA basis, `ta.ema`-smoothed true-range (or `high - low`) bands                      |
| `ta.kcw`                             | yes            | draft                | `(upper - lower) / basis` from `ta.kc`; no `* 100`                                   |
| `ta.obv`                             | yes            | draft                | `cum(sign(change(close)) * volume)`; na terms skipped                                |
| `ta.pvt`                             | yes            | draft                | `cum((change(close) / close[1]) * volume)`                                           |
| `ta.pvi`                             | yes            | draft                | seed 1.0; updates only when volume rises                                             |
| `ta.nvi`                             | yes            | draft                | seed 1.0; updates only when volume falls                                             |
| `ta.mfi`                             | yes            | draft                | `math.sum` windows, not Wilder smoothing; na change seeds both flows                 |
| `ta.vwap`                            | yes            | draft                | anchored cumulative; default daily anchor in the symbol timezone                     |
| `ta.accdist`                         | yes            | draft                | standard Chaikin A/D line (reference ships no re-implementation)                     |
| `ta.barssince`                       | yes            | draft                | 0 on the condition bar; na when never true                                           |
| `ta.rising`                          | yes            | draft                | strict chain over the last `length` non-na prior values                              |
| `ta.falling`                         | yes            | draft                | strict decreasing chain; mirror of `rising`                                          |
| `ta.valuewhen`                       | yes            | draft                | nth most recent condition bar; 0 includes the current bar                            |
| `ta.highestbars`                     | yes            | draft                | negative offset; ties resolve to the most recent bar                                 |
| `ta.lowestbars`                      | yes            | draft                | negative offset; ties resolve to the most recent bar                                 |
| `ta.pivothigh`                       | yes            | draft                | strict dominance; equal neighbors block the pivot                                    |
| `ta.pivotlow`                        | yes            | draft                | mirror of `pivothigh` over the low series                                            |
| `ta.cum`                             | yes            | draft                | running total; na terms skipped (cumulative convention)                              |
| `ta.max`                             | yes            | draft                | all-time high; na occurrences ignored                                                |
| `ta.min`                             | yes            | draft                | all-time low; na occurrences ignored                                                 |
| `ta.cross`                           | yes            | draft                | crossover or crossunder                                                              |
| `ta.alma`                            | yes            | draft                | Gaussian weights per the reference; strict window; optional floored offset center    |
| `ta.median`                          | yes            | draft                | skip-na window; even windows average the two middle values                           |
| `ta.mode`                            | yes            | draft                | most frequent value; ties resolve to the smallest                                    |
| `ta.range`                           | yes            | draft                | max - min over the skip-na window                                                    |
| `ta.percentile_nearest_rank`         | yes            | draft                | rank = ceil(percentage / 100 * length); always a window member                       |
| `ta.percentile_linear_interpolation` | yes            | draft                | interpolated between the two nearest ranks; strict window                            |
| `ta.percentrank`                     | yes            | draft                | weak percent rank including the current bar; strict window                           |
| `ta.correlation`                     | yes            | draft                | Pearson over bar-aligned non-na pairs                                                |
| `ta.rci`                             | yes            | draft                | Spearman rank vs bar index, scaled to [-100, 100]; strict window                     |
| `ta.cci`                             | yes            | draft                | Lambert 0.015 scaling against SMA and mean deviation                                 |
| `ta.cog`                             | yes            | draft                | literal reference re-implementation; positional weights over the non-na window       |
| `ta.tsi`                             | yes            | draft                | nested-EMA double-smoothed momentum; [-1, 1] range per the reference                 |
| `ta.iii`                             | yes            | draft                | per-bar intraday intensity per the reference re-implementation                       |
| `ta.wad`                             | yes            | draft                | `ta.cum(gain)` per the reference re-implementation                                   |
| `ta.wvad`                            | yes            | draft                | per-bar Williams variable A/D per the reference re-implementation                    |

## Compatibility states

- **verified** — implementation has passed a pinned Pine reference vector plus applicable warm-up, `na`, history, and realtime tests.
- **draft** — implementation exists and has deterministic unit coverage, but reference parity is not yet pinned.
- **planned** — manifest contract exists; implementation has not shipped.
- **unsupported** — deliberately unavailable because the runtime/provider cannot satisfy the contract.

Do not promote `draft` to `verified` based on mathematical plausibility or agreement with another TA library.

## Next implementation groups

1. `ta.vwap` `stdev_mult` tuple overload (blocked on the v6 reference documenting the band formula).
2. Promote `draft` built-ins to `verified` by pinning reference vectors against real TradingView output; `pnpm fixtures:verify` re-runs every shipped fixture against the runtime.
3. Aroon-style helpers built from `ta.highestbars` / `ta.lowestbars` once user demand exists (Aroon itself is not a Pine v6 built-in).

`ta.pivot_point_levels` shipped with the `array` namespace: all six types
(Traditional, Fibonacci, Woodie, Classic, DM, Camarilla) with anchor and
developing modes, TradingView's own Pivot Points Standard formulas, and the
Woodie+developing runtime error. The five `array.new_*` drawing constructors
(`box`/`label`/`line`/`linefill`/`table`) remain planned with the drawing
namespaces.

The catalog-completion group is done: every `ta` symbol in the v6 Reference
Manual now has a manifest entry — running aggregates (`cum`/`max`/`min`),
`cross`, the moving average `alma`, the statistics family (`median`/`mode`/
`range`/`percentile_nearest_rank`/`percentile_linear_interpolation`/
`percentrank`/`correlation`/`rci`), momentum (`cci`/`cog`/`tsi`), and the
volume variables (`iii`/`wad`/`wvad`) all ship with fixtures, unit tests, and
invariant coverage. The `hlcc4` source joined the OHLCV bundle.

Correction (2026-09, verified against the TradingView v6 Reference Manual):
`aroon` and `ichimoku` are **not** Pine v6 built-ins — Aroon is a TradingView
chart indicator and Ichimoku has no `ta.ichimoku` namespace function, so both
were removed from this plan. Pine scripts build Aroon from
`ta.highestbars(high, length + 1)` / `ta.lowestbars(low, length + 1)`, which
now ships with the events/windows group. The trend group
(`sar`, `linreg`) is complete.

Semantics note (2026-09, verified against the TradingView v6 Reference Manual
remarks): windowed built-ins document "na values in the source series are
ignored; the function calculates on the length quantity of non-na values".
`ta.highest`, `ta.lowest`, `ta.variance`, `ta.stdev`, and `ta.dev` were
re-aligned to that model (windows extend back past na bars; a na current
value still yields na, matching the verified `ta.sma` behavior).

## Compatibility rule

Every implementation must have, where applicable:

- numerical Pine reference fixtures;
- warm-up/`na` behavior tests;
- history-indexing tests;
- realtime rollback tests;
- independent-runtime isolation tests;
- performance coverage for incremental execution;
- a manifest entry with signature, semantics, implementation provenance, status, and vector references.

TradingView documents that the v6 Reference Manual provides built-in signatures, qualified argument types, return types, and behavior. The compatibility suite therefore treats Pine as the oracle rather than copying APIs from unrelated TA libraries.
