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
- [x] gaps/lookahead semantics on `security_lower_tf` (2026-10: `lookahead=off` excludes the still-forming intrabar; `gaps=on` returns an empty tuple when no intrabars match; `gaps=off` carries forward the last intrabar's value as a single-element tuple)
- [x] `lookahead=on` repainting semantics on confirmed HTF contexts (engine reads the bar containing caller time; full repainting test coverage is now in `tests/wave8-request-security.test.ts`)
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
- [x] `ChartAdapter` (2026-10): renderer-neutral adapter that consumes the `VisualEvent` stream and produces renderable `Primitive`s + an SVG string (`src/visual/adapter.ts`). Tested in `tests/wave10-visual-adapter.test.ts`.

## Phase 6 — Strategies

- [x] strategy declaration/context
- [x] broker emulator (built-in to `StrategyEngine`)
- [x] entry/order/exit/cancel/close/close_all (module-level + engine methods)
- [x] commissions/slippage (`commission_type` percent/cash, `slippage_unit` points/percent)
- [x] position/trade state (`position_size`, `position_avg_price`, `equity`, `netprofit`, `grossprofit/loss`, `drawdown/max_drawdown`, `closedtrades_number`, `opentrades_number`)
- [x] performance metrics
- [x] `BrokerAdapter` boundary (`PaperBrokerAdapter` in-memory + `BinanceBrokerAdapter` scaffold)
- [x] `MockBinanceTradingSurface` reference implementation (2026-10): an in-memory Binance-shaped surface that simulates market/limit/stop/stop-limit fills against a bar OHLC + tracks positions and emits onOrderUpdate callbacks. Downstream integrators can wire a real Binance SDK against this contract surface; tests run end-to-end without real API credentials.
- [ ] paper/live broker adapters: Binance live adapter wired to `@nemesis-oss/binance-sdk`'s trading surface (scaffold + mock in place; downstream integrator wires with real API credentials)
- [ ] `strategy.*` v6 variables (49 total — partial completion; major variables shipped)

## Phase 7 — Pine source compatibility

Only after runtime/API semantics stabilize: lexer, parser, AST, semantic analysis, and Pine-to-runtime compilation/execution.

## Release gate

A namespace is complete only when its API signatures are represented in the manifest, semantics are documented, reference fixtures pass, historical/realtime behavior is covered where applicable, provider limitations are explicit, and performance benchmarks remain within budget.
