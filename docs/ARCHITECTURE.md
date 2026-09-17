# Architecture

## Design rule

The runtime owns Pine semantics. Providers own market data. Brokers own execution. Renderers own visualization.

## Dependency direction

```text
Trading bot
   |
   v
pine-ts public API
   |
   +-- runtime / execution / series / state
   +-- ta / math / collections / strings / colors
   +-- request / timeframe / sessions
   +-- strategy / broker interfaces
   +-- plotting / drawing / alerts
   |
   +--> MarketDataProvider --> BinanceProvider --> @nemesis-oss/binance-sdk
   |
   +--> Renderer adapters
```

Core must never import a charting package or concrete exchange client.

## Series engine

`Series<T>` stores committed values and supports Pine-style historical offsets: `at(0)` is the current value and `at(1)` is the previous committed value. Indicator implementations should use incremental state and avoid whole-history rescans on every bar.

## Execution model

Historical execution runs deterministically once per bar. Realtime execution will support repeated updates of an open bar and explicit rollback/commit semantics. This is necessary to model Pine's historical/realtime distinction and repaint-sensitive calculations.

## Multi-timeframe requests

`request.*` will resolve independent symbol/timeframe execution contexts and align their results to the caller's context. Lookahead, gaps, confirmation, and lower-timeframe intrabars are explicit runtime concepts.

## Strategies

`strategy.*` expresses order intent. A broker interface performs fills. Backtesting uses a deterministic Pine-style emulator; paper and live brokers are separate adapters.

## Visuals

Plots and drawing objects emit renderer-neutral events. Chart packages consume those events through adapters, keeping the runtime usable in non-browser trading bots.
