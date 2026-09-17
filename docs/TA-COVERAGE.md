# `ta.*` coverage

`api-manifest/ta.yaml` is the canonical compatibility manifest. `api-manifest/ta.v6.json` remains the machine-readable namespace inventory used by legacy inventory tooling. A manifest symbol is never considered complete merely because an export exists.

## Current implementation

| Symbol | Implementation | Compatibility status | Notes |
|---|---|---|---|
| `ta.sma` | yes | verified | incremental rolling state |
| `ta.ema` | yes | verified | incremental state, first-valid seed |
| `ta.highest` | yes | verified | rolling window |
| `ta.lowest` | yes | verified | rolling window |
| `ta.change` | yes | verified | Pine history semantics |
| `ta.crossover` | yes | verified | current/previous comparison |
| `ta.crossunder` | yes | verified | current/previous comparison |
| `ta.rma` | yes | draft | Wilder smoothing node; reference vector pending |
| `ta.tr` | yes | draft | implicit OHLC source node; reference vector pending |
| `ta.atr` | yes | draft | composed from `rma(tr(true), length)`; reference vector pending |
| `ta.wma` | yes | draft | composable finite-window weighted average |
| `ta.vwma` | yes | draft | source/volume weighted window |
| `ta.swma` | yes | draft | fixed four-bar 1:2:2:1 kernel |
| `ta.hma` | yes | draft | composed from WMA nodes |

## Compatibility states

- **verified** — implementation has passed a pinned Pine reference vector plus applicable warm-up, `na`, history, and realtime tests.
- **draft** — implementation exists and has deterministic unit coverage, but reference parity is not yet pinned.
- **planned** — manifest contract exists; implementation has not shipped.
- **unsupported** — deliberately unavailable because the runtime/provider cannot satisfy the contract.

Do not promote `draft` to `verified` based on mathematical plausibility or agreement with another TA library.

## Next implementation groups

1. Momentum: `rsi`, `roc`, `mom`, `stoch`, `cmo`, `wpr`.
2. Volatility/statistics: `stdev`, `variance`, `dev`, `bb`, `bbw`, `kc`, `kcw`.
3. Trend: `macd`, `dmi`, `adx`, `aroon`, `supertrend`, `sar`, `linreg`.
4. Volume/flow: `obv`, `pvt`, `pvi`, `nvi`, `mfi`, `vwap`, `accdist`.
5. Events/windows: `barssince`, `rising`, `falling`, `valuewhen`, `highestbars`, `lowestbars`, pivots.
6. Composite/multi-return APIs: `macd`, `bb`, `dmi`, `ichimoku`, and other tuple-returning functions.

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
