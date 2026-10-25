# `ta.*` coverage

`api-manifest/ta.yaml` is the canonical compatibility manifest. `api-manifest/ta.v6.json` remains the machine-readable namespace inventory used by legacy inventory tooling. A manifest symbol is never considered complete merely because an export exists.

## Current implementation

| Symbol                               | Implementation | Compatibility status | Notes                                                                                                                                                                                                                                     |
| ------------------------------------ | -------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ta.sma`                             | yes            | verified             | Kahan-sum running-sum kernel (`src/ta/running-sum.ts`) — bit-for-bit match against PineScript-exported vectors (`tests/reference-pine-vectors-running-sum.test.ts`); na/Infinity skipped; previous result carried forward on na bars      |
| `ta.ema`                             | yes            | verified             | SMA seed on the length-th valid bar, `na` warm-up, Kahan seed order, `(v - prev) * alpha + prev`; pinned via the Pine-exported `ta.tsi` vectors                                                                                           |
| `ta.rma`                             | yes            | draft                | Wilder smoothing: SMA seed (Kahan order), `(v + (length-1) * prev) / length`                                                                                                                                                              |
| `ta.highest`                         | yes            | verified             | rolling window                                                                                                                                                                                                                            |
| `ta.lowest`                          | yes            | verified             | rolling window                                                                                                                                                                                                                            |
| `ta.change`                          | yes            | verified             | Pine history semantics                                                                                                                                                                                                                    |
| `ta.crossover`                       | yes            | verified             | current/previous comparison                                                                                                                                                                                                               |
| `ta.crossunder`                      | yes            | verified             | current/previous comparison                                                                                                                                                                                                               |
| `ta.rma`                             | yes            | draft                | Wilder smoothing node                                                                                                                                                                                                                     |
| `ta.tr`                              | yes            | draft                | implicit OHLC source node                                                                                                                                                                                                                 |
| `ta.atr`                             | yes            | draft                | composed from `rma(tr(true), length)`                                                                                                                                                                                                     |
| `ta.wma`                             | yes            | verified             | oldest-first weighted sum via `wmaAdd` cancellation rule (Pine #136); na inside window filled with previous non-na; bit-for-bit match against PineScript-exported vectors (`tests/reference-pine-vectors-wma.test.ts`)                    |
| `ta.vwma`                            | yes            | draft                | source/volume weighted window                                                                                                                                                                                                             |
| `ta.swma`                            | yes            | draft                | fixed four-bar 1:2:2:1 kernel                                                                                                                                                                                                             |
| `ta.hma`                             | yes            | draft                | composed from WMA nodes                                                                                                                                                                                                                   |
| `ta.rsi`                             | yes            | draft                | Wilder smoothing; first value on the length-th change                                                                                                                                                                                     |
| `ta.roc`                             | yes            | draft                | percentage rate of change                                                                                                                                                                                                                 |
| `ta.mom`                             | yes            | draft                | `source - source[length]`                                                                                                                                                                                                                 |
| `ta.stoch`                           | yes            | verified             | zero range and na source keep the previous result; windows skip na — pinned bit-for-bit against Pine output                                                                                                                               |
| `ta.wpr`                             | yes            | draft                | William %R over high/low windows                                                                                                                                                                                                          |
| `ta.cmo`                             | yes            | draft                | rolling gain/loss balance over the last length changes                                                                                                                                                                                    |
| `ta.variance`                        | yes            | verified             | biased/unbiased rolling variance via two Kahan running sums (`sum(x)` + `sum(x²)`); bit-for-bit match against PineScript-exported AAPL_CLOSE vectors (`tests/reference-pine-vectors-running-sum.test.ts`)                                 |
| `ta.stdev`                           | yes            | verified             | `sqrt(variance)` with Pine's clamp `v > 0 ? sqrt(v) : 0` for tiny negative Kahan residues; bit-for-bit match against PineScript-exported BUY_PROXY + AAPL_CLOSE vectors (`tests/reference-pine-vectors-running-sum.test.ts`)              |
| `ta.dev`                             | yes            | draft                | mean absolute deviation                                                                                                                                                                                                                   |
| `ta.macd`                            | yes            | draft                | `MacdResult` from EMA nodes; outputs warm up with the corrected EMA seeding                                                                                                                                                               |
| `ta.bb`                              | yes            | draft                | `BollingerBandsResult` from SMA/stdev nodes                                                                                                                                                                                               |
| `ta.dmi`                             | yes            | draft                | `DmiResult` with Wilder-smoothed +DI/-DI/ADX                                                                                                                                                                                              |
| `ta.supertrend`                      | yes            | draft                | `SupertrendResult` with carry-forward ATR bands                                                                                                                                                                                           |
| `ta.sar`                             | yes            | draft                | literal `pine_sar` algorithm from the v6 reference                                                                                                                                                                                        |
| `ta.linreg`                          | yes            | verified             | oldest-first x = 1..length least squares; intercept at x = 1 — pinned bit-for-bit against Pine output                                                                                                                                     |
| `ta.bbw`                             | yes            | draft                | `(((basis + dev) - (basis - dev)) / basis) * 100` per the official re-implementation                                                                                                                                                      |
| `ta.kc`                              | yes            | draft                | EMA basis, `ta.ema`-smoothed true-range (or `high - low`) bands                                                                                                                                                                           |
| `ta.kcw`                             | yes            | draft                | `(upper - lower) / basis` from `ta.kc`; no `* 100`                                                                                                                                                                                        |
| `ta.obv`                             | yes            | draft                | `cum(sign(change(close)) * volume)`; na terms skipped                                                                                                                                                                                     |
| `ta.pvt`                             | yes            | draft                | `cum((change(close) / close[1]) * volume)`                                                                                                                                                                                                |
| `ta.pvi`                             | yes            | draft                | seed 1.0; updates only when volume rises                                                                                                                                                                                                  |
| `ta.nvi`                             | yes            | draft                | seed 1.0; updates only when volume falls                                                                                                                                                                                                  |
| `ta.mfi`                             | yes            | draft                | `math.sum` Kahan running-sum windows (upper/lower), not Wilder smoothing; na change seeds both flows. Pending a direct PineScript reference vector pin to promote to `verified` (currently inferred-verified via the running-sum kernel). |
| `ta.vwap`                            | yes            | draft                | anchored cumulative; default daily anchor in the symbol timezone                                                                                                                                                                          |
| `ta.accdist`                         | yes            | draft                | standard Chaikin A/D line (reference ships no re-implementation)                                                                                                                                                                          |
| `ta.barssince`                       | yes            | draft                | 0 on the condition bar; na when never true                                                                                                                                                                                                |
| `ta.rising`                          | yes            | draft                | strict chain over the last `length` non-na prior values                                                                                                                                                                                   |
| `ta.falling`                         | yes            | draft                | strict decreasing chain; mirror of `rising`                                                                                                                                                                                               |
| `ta.valuewhen`                       | yes            | draft                | nth most recent condition bar; 0 includes the current bar                                                                                                                                                                                 |
| `ta.highestbars`                     | yes            | draft                | negative offset; ties resolve to the most recent bar                                                                                                                                                                                      |
| `ta.lowestbars`                      | yes            | draft                | negative offset; ties resolve to the most recent bar                                                                                                                                                                                      |
| `ta.pivothigh`                       | yes            | draft                | strict dominance; equal neighbors block the pivot                                                                                                                                                                                         |
| `ta.pivotlow`                        | yes            | draft                | mirror of `pivothigh` over the low series                                                                                                                                                                                                 |
| `ta.cum`                             | yes            | draft                | running cumulative sum; na terms skipped; output is na on na bars                                                                                                                                                                         |
| `ta.cross`                           | yes            | draft                | crossover or crossunder in either direction                                                                                                                                                                                               |
| `ta.percentrank`                     | yes            | draft                | % of window values strictly < current; 0–100; na during warmup                                                                                                                                                                            |
| `ta.percentile_nearest_rank`         | yes            | draft                | nearest-rank percentile: ceil(p/100\*n)-th sorted value                                                                                                                                                                                   |
| `ta.percentile_linear_interpolation` | yes            | draft                | linear-interpolation percentile via fractional 0-based sorted index                                                                                                                                                                       |
| `ta.correlation`                     | yes            | draft                | Pearson correlation over the last `length` non-na paired samples                                                                                                                                                                          |
| `ta.max`                             | yes            | draft                | running maximum of all non-na values (no length window)                                                                                                                                                                                   |
| `ta.min`                             | yes            | draft                | running minimum of all non-na values (no length window)                                                                                                                                                                                   |
| `ta.median`                          | yes            | draft                | median of the last `length` non-na values; even length averages two middle                                                                                                                                                                |
| `ta.mode`                            | yes            | draft                | most frequent value; ties resolve to the smallest tied value (v6 remark)                                                                                                                                                                  |
| `ta.range`                           | yes            | draft                | `ta.highest(source, length) - ta.lowest(source, length)`                                                                                                                                                                                  |
| `ta.alma`                            | yes            | draft                | Arnaud Legoux Moving Average — Gaussian-weighted kernel over a length window                                                                                                                                                              |
| `ta.cog`                             | yes            | draft                | negative bar-position-weighted price sum divided by the unweighted sum                                                                                                                                                                    |
| `ta.cci`                             | yes            | verified             | Lambert CCI; flat windows keep the previous result (1e-10 tolerance), first flat window 0 — pinned bit-for-bit against Pine output                                                                                                        |
| `ta.tsi`                             | yes            | verified             | `ta.change(source)` (1-bar) double-smoothed; RATIO in [-1, 1], not x100 — pinned bit-for-bit against Pine output                                                                                                                          |
| `ta.rci`                             | yes            | draft                | Rank Correlation Index: `100 * Spearman(price, time)` with average-rank tie-break                                                                                                                                                         |
| `ta.iii`                             | yes            | draft                | Intraday Intensity Index — cumulative `((2*C - H - L) / (H - L)) * V`                                                                                                                                                                     |
| `ta.wad`                             | yes            | draft                | Williams A/D cumulative (true-high/true-low rule, no volume)                                                                                                                                                                              |
| `ta.wvad`                            | yes            | draft                | Williams Variable A/D per-bar term per v6 re-implementation                                                                                                                                                                               |
| `ta.pivot_point_levels`              | yes            | draft                | returns `PineArray<number>` of 11 levels (PP, R1..R5, S1..S5); supports TRADITIONAL, FIBONACCI, WOODIE, CLASSIC, DE_MARK, CAMARILLA                                                                                                       |

## Compatibility states

- **verified** — implementation has passed a pinned Pine reference vector plus applicable warm-up, `na`, history, and realtime tests.
- **draft** — implementation exists and has deterministic unit coverage, but reference parity is not yet pinned.
- **planned** — manifest contract exists; implementation has not shipped.
- **unsupported** — deliberately unavailable because the runtime/provider cannot satisfy the contract.

Do not promote `draft` to `verified` based on mathematical plausibility or agreement with another TA library.

## SuperTrend core

`ta.supertrend` and community SuperTrend variants share one literal
transcription of the reference `pine_supertrend(factor, atr)`
(`src/ta/supertrend-core.ts`): `nz(band[1])` carry, comparisons with na are
false, and `na(atr[1])` resets the direction to 1. `ta.supertrend` returns a na
line while its ATR is na (warm-up); scripts that define their own
`pine_supertrend` get the transcription's warm-up values.

## Length qualifiers and conditional calls

Verified against the v6 Reference Manual (2026-09): `sma`, `wma`, `vwma`,
`highest`, `lowest`, `highestbars`, `lowestbars`, `change`, `mom`, `roc`,
`cmo`, `stoch`, `wpr`, `mfi`, `variance`, `stdev`, `dev`, `linreg`, `bb`,
`bbw`, `rising`, `falling`, `percentrank`, and both percentile functions take a
`series int` length; `ema`, `rma`, `rsi`, `atr`, `hma`, `kc`, and `kcw` take a
`simple int` length. Changing a `series int` length yields the value computed
over the argument's history: history-reading implementations do this
directly, and the incremental ones (`sma`, `cmo`, `mfi`) seed a new node from
committed history. A `ta.*` call that does not execute on a bar keeps its
state and carries its last value forward (see `docs/SEMANTICS.md`).

## Missing v6 `ta` symbols

The entire v6 `ta.*` namespace is now implemented in pine-ts. The `ta.*` manifest
tracks 67 functions, of which:

- 14 are `verified` (`sma`, `ema`, `highest`, `lowest`, `change`, `crossover`, `crossunder`, `stoch`, `cci`, `tsi`, `linreg`, `variance`, `stdev`, `wma`).
- 53 are `draft` (deterministic unit coverage; pending TradingView-exported reference vectors for promotion to `verified`).

The 2026-10 waves shipped: `correlation`, `alma`, `cci`, `cog`, `max`, `min`,
`median`, `mode`, `range`, `rci`, `tsi`, the variables `iii`, `wad`, `wvad`,
and finally `pivot_point_levels` — transcribed from the v6 Reference Manual
re-implementations where available, and from the documented remarks otherwise.

## Next implementation groups

1. Composite/multi-return APIs (remaining): `ta.vwap` `stdev_mult` tuple overload (blocked on the v6 reference documenting the band formula), other tuple-returning functions.
2. Promote `draft` built-ins to `verified` by pinning reference vectors against real TradingView output.
3. Aroon-style helpers built from `ta.highestbars` / `ta.lowestbars` once user demand exists (Aroon itself is not a Pine v6 built-in).

Groups 1-3 from the previous plan (bands `bbw`/`kc`/`kcw`, volume/flow `obv`/`pvt`/`pvi`/`nvi`/`mfi`/`vwap`/`accdist`, and events/windows `barssince`/`rising`/`falling`/`valuewhen`/`highestbars`/`lowestbars`/`pivothigh`/`pivotlow`) are now complete.

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
