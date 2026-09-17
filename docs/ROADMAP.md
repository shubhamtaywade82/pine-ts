# pine-ts roadmap

## Phase 0 — Foundation

- [x] Bootstrap repository/package
- [x] Strict TypeScript 5.x / Node 22 configuration
- [x] `Series<T>` history model
- [x] OHLCV execution context
- [x] deterministic historical runtime loop
- [x] first `ta.*` numerical primitives
- [x] market-data provider boundary
- [ ] Binance adapter using `@nemesis-oss/binance-sdk`
- [ ] CI and compatibility fixtures

## Phase 1 — Pine execution semantics

- `na` semantics
- scalar/series typing rules
- `var` and `varip`
- realtime tick execution
- rollback/commit
- barstate
- timeframe canonicalization
- symbol metadata
- sessions

## Phase 2 — `ta.*`

Catalog the complete v6 `ta` namespace from TradingView's Reference Manual, then implement each function with deterministic numerical fixtures and edge-case tests. Group implementations by trend, momentum, volatility, volume, statistics, and support functions.

## Phase 3 — Core namespaces

- `math.*`
- `array.*`
- `matrix.*`
- `map.*`
- `str.*`
- `color.*`
- `input.*`

## Phase 4 — MTF/data requests

- `request.security()`
- `request.security_lower_tf()`
- gaps/lookahead
- confirmed HTF behavior
- multi-symbol/timeframe caching
- provider capability errors

## Phase 5 — Visual runtime

- plot/hline/fill
- bgcolor/barcolor
- line/linefill
- box/polyline
- label
- table
- chart.point

## Phase 6 — Strategies

- strategy declaration/context
- broker emulator
- entry/order/exit/cancel
- commissions/slippage
- position/trade state
- performance metrics
- backtesting
- paper/live broker adapters

## Phase 7 — Pine source compatibility

Only after runtime/API semantics stabilize: lexer, parser, AST, semantic analysis, and Pine-to-runtime compilation/execution.

## Release gate

A namespace is complete only when its API signatures are represented in the manifest, semantics are documented, reference fixtures pass, historical/realtime behavior is covered where applicable, provider limitations are explicit, and performance benchmarks remain within budget.
