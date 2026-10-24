# pine-ts roadmap

## Phase 0 — Foundation

- [x] Bootstrap repository/package
- [x] Strict TypeScript 5.x / Node 22 configuration
- [x] `Series<T>` history model
- [x] OHLCV execution context
- [x] deterministic historical runtime loop
- [x] first `ta.*` numerical primitives
- [x] market-data provider boundary
- [x] Binance adapter using `@nemesis-oss/binance-sdk` (REST paging, kline stream, exchangeInfo symbol metadata)
- [x] DhanHQ adapter using `@nemesis-oss/dhanhq-sdk` (session-anchored bars from 1-minute history and feed ticks, scrip-master symbol metadata)
- [ ] CI and compatibility fixtures

## Phase 1 — Pine execution semantics

- [x] `na` semantics (`NaN` canonical value, `undefined` = no history, `fixnan`)
- scalar/series typing rules
- [x] `var` and `varip`
- [x] realtime tick execution (closing-tick confirmation, stale-update rejection)
- [x] rollback/commit
- [x] barstate (including the historical-to-realtime hand-off)
- [x] local-scope execution semantics and `ctx.scope` call-site identity
- [x] bounded history (`maxBarsBack`)
- [x] timeframe canonicalization
- symbol metadata
- sessions

## Phase 2 — `ta.*`

Catalog the complete v6 `ta` namespace from TradingView's Reference Manual, then implement each function with deterministic numerical fixtures and edge-case tests. Group implementations by trend, momentum, volatility, volume, statistics, and support functions.

## Phase 3 — Core namespaces

- [x] `math.*`
- [x] `array.*`
- [x] `matrix.*`
- [x] `map.*`
- `str.*`
- `color.*`
- `input.*`

## Phase 4 — MTF/data requests

- [x] `request.security()` (multi-context execution engine + alignment; non-repainting `lookahead=off` default; per-expression caching by `expression.toString()`)
- [x] `request.security_lower_tf()` (returns intrabar values within the caller bar's window)
- [x] gaps/lookahead option validation
- [x] `runtime.prepareSecurity(symbol, timeframe)` host API for pre-warming
- [ ] gaps/lookahead semantics on `security_lower_tf` (deferred — returns all intrabars within window regardless of options for now)
- [ ] `lookahead=on` repainting semantics on confirmed HTF contexts (engine reads the bar containing caller time; full repainting test coverage is draft)
- multi-symbol/timeframe caching (per `(symbol, timeframe)` pair, with per-expression result caching)
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

- [x] strategy declaration/context
- [x] broker emulator (built-in to `StrategyEngine`)
- [x] entry/order/exit/cancel/close/close_all (module-level + engine methods)
- [x] commissions/slippage (`commission_type` percent/cash, `slippage_unit` points/percent)
- [x] position/trade state (`position_size`, `position_avg_price`, `equity`, `netprofit`, `grossprofit/loss`, `drawdown/max_drawdown`, `closedtrades_number`, `opentrades_number`)
- [x] performance metrics
- [x] `BrokerAdapter` boundary (`PaperBrokerAdapter` in-memory + `BinanceBrokerAdapter` scaffold)
- [ ] paper/live broker adapters: Binance live adapter wired to `@nemesis-oss/binance-sdk`'s trading surface (scaffold in place; downstream integrator wires)
- [ ] `strategy.*` v6 variables (49 total — partial completion; major variables shipped)

## Phase 7 — Pine source compatibility

Only after runtime/API semantics stabilize: lexer, parser, AST, semantic analysis, and Pine-to-runtime compilation/execution.

## Release gate

A namespace is complete only when its API signatures are represented in the manifest, semantics are documented, reference fixtures pass, historical/realtime behavior is covered where applicable, provider limitations are explicit, and performance benchmarks remain within budget.
