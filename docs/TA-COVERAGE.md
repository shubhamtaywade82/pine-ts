# `ta.*` coverage

`api-manifest/ta.v6.json` is the compatibility inventory. It is deliberately tracked separately from implementation so an API symbol is never mistaken for a completed implementation.

## Current implementation

| Symbol | Status | Notes |
|---|---|---|
| `ta.sma` | implemented | incremental rolling state |
| `ta.ema` | implemented | incremental state, SMA seed |
| `ta.highest` | implemented | rolling window |
| `ta.lowest` | implemented | rolling window |
| `ta.change` | implemented | Pine history semantics |
| `ta.crossover` | implemented | current/previous comparison |
| `ta.crossunder` | implemented | current/previous comparison |

## Next implementation groups

1. Wilder / smoothing: `rma`, `atr`, `tr`, `wma`, `vwma`, `swma`, `hma`.
2. Momentum: `rsi`, `roc`, `mom`, `stoch`, `cmo`, `wpr`.
3. Volatility/statistics: `stdev`, `variance`, `dev`, `bb`, `bbw`, `kc`, `kcw`.
4. Trend: `macd`, `dmi`, `adx`, `aroon`, `supertrend`, `sar`, `linreg`.
5. Volume/flow: `obv`, `pvt`, `pvi`, `nvi`, `mfi`, `vwap`, `accdist`.
6. Events/windows: `barssince`, `rising`, `falling`, `valuewhen`, `highestbars`, `lowestbars`, pivots.
7. Composite/multi-return APIs: `macd`, `bb`, `dmi`, `ichimoku`, and other tuple-returning functions.

## Compatibility rule

Every implementation must have:

- numerical reference tests;
- warm-up/`na` behavior tests;
- history-indexing tests;
- realtime rollback tests where stateful;
- performance coverage for incremental execution;
- a documented signature matching the Pine v6 Reference Manual.

TradingView states that the v6 Reference Manual is the definitive reference for Pine built-ins and documents signatures, qualified argument types, return types, and behavior. The implementation therefore follows the manual rather than copying APIs from unrelated TA libraries.
