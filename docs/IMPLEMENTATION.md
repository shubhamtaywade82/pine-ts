# Implementation plan

This is the execution plan for building a TypeScript Pine v6-compatible runtime. Work proceeds in dependency order; later features cannot bypass the semantic core.

## Milestone 1 — Runtime kernel

1. `Series<T>` with committed history and mutation rules.
2. `na`/undefined compatibility policy.
3. persistent `var` / `varip` state.
4. execution context and built-in series (`open`, `high`, `low`, `close`, `volume`, `time`, `hl2`, `hlc3`, `ohlc4`).
5. historical bar execution.
6. realtime tick execution.
7. rollback/commit snapshots.
8. `barstate.*` semantics.
9. timeframe/symbol/session primitives.

## Milestone 2 — `ta.*`

Build an API inventory from the v6 Reference Manual. Implement each function as a pure public operation backed by runtime-aware incremental state where needed. Cover trend, momentum, volatility, volume, statistical, cycle, support, and price-action functions.

Validation:

- deterministic fixtures;
- warm-up/insufficient-history cases;
- `na` propagation;
- comparison against TradingView-generated reference datasets;
- performance benchmark across long histories.

## Milestone 3 — Data requests

Implement `request.security()` and `request.security_lower_tf()` over a provider abstraction. Add cache keys for `(symbol,timeframe,expression,request-options)`, context alignment, gaps, lookahead, and confirmed HTF handling.

## Milestone 4 — Binance

Implement `BinanceProvider` backed directly by `@nemesis-oss/binance-sdk`. REST supplies historical data; SDK WebSockets supply realtime klines/ticks. Do not duplicate SDK rate limiting, reconnection, authentication, or numeric primitives.

## Milestone 5 — Collections and utility namespaces

Implement `math.*`, `array.*`, `matrix.*`, `map.*`, `str.*`, `color.*`, and `input.*` using Pine-compatible semantics with TypeScript-native typing.

## Milestone 6 — Visual runtime

Implement renderer-neutral events for plots, hlines, fills, backgrounds, candles/bars, lines, linefills, boxes, polylines, labels, tables, and chart points.

## Milestone 7 — Strategy engine

Implement the Pine strategy namespace, deterministic broker emulator, fills, order state, position state, commissions, slippage, pyramiding, reversals, exits, cancellations, closed-trade/open-trade collections, and performance metrics. Then expose paper/live broker adapters.

## Milestone 8 — Pine source compatibility

After runtime semantics stabilize, build a Pine lexer/parser/AST/compiler. The parser is a consumer of the runtime, not the runtime itself.

## Quality gates

Every milestone must ship tests, documentation, and benchmarks. No function should be marked supported merely because a TypeScript signature exists; observable behavior is the compatibility criterion.
