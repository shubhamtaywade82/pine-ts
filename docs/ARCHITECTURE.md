# Pine-TS Architecture

## Architectural goal

`pine-ts` is an analytical runtime, not a generic indicator collection. The architecture separates Pine execution semantics, mutable runtime state, market-data integration, series storage, and mathematical TA kernels.

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
   +--> MarketDataProvider --> exchange/broker adapter
   |
   +--> renderer adapters
```

Core must never import a charting package or concrete exchange client.

## Runtime layers

```text
Public API
   |
   v
PineRuntime / PineContext          <- execution facade
   |
   +--> PineState                   <- persistent state + rollback memento
   +--> OhlcvSeries                  <- series/value facade
   +--> MarketDataProvider           <- external-data adapter boundary
   |
   v
TA API / mathematical kernels       <- deterministic analytical logic
   |
   v
Compatibility fixtures/tests        <- Pine v6 behavioral oracle
```

## Design patterns

### Strategy

`PineScript` is a strategy supplied to `PineRuntime`. The runtime owns execution; callers supply the behavior to execute.

### Memento

`PineState.snapshot()` and `restore()` represent the committed Pine state used for realtime rollback. The snapshot boundary is a semantic boundary, not merely an optimization.

### Adapter

`MarketDataProvider` adapts exchanges, brokers, replay files, and test fixtures to the runtime without coupling Pine execution to a particular vendor.

### Facade

`PineRuntime` is the high-level execution facade. `PineContext` is the Pine-facing facade over the current bar, series, state, symbol information, and bar state.

### Factory

Use factories when multiple interchangeable implementations are actually required, such as replay versus live providers or different state/cache strategies. Do not introduce factories solely to increase abstraction count.

### Observer

Runtime events/telemetry may use an observer/subscription model. Observability must remain orthogonal to indicator mathematics and must never alter calculation results.

Do not force GoF patterns into small mathematical functions. A pattern is justified only when it reduces coupling, isolates change, or makes a Pine semantic explicit.

## Clean-code rules

1. Prefer composition over inheritance.
2. Keep mathematical functions deterministic and side-effect free where possible.
3. Keep mutable state behind explicit boundaries.
4. Depend on domain abstractions rather than concrete exchanges/frameworks.
5. Avoid module-level mutable runtime state.
6. Do not create a class for a simple formula.
7. Prefer small functions with one responsibility and guard clauses.
8. Use precise names, `readonly` contracts, discriminated unions, `unknown` instead of `any`, and `import type` for type-only dependencies.
9. Do not weaken TypeScript or ESLint rules to make a change pass.
10. Optimize only after correctness and profiling demonstrate the need.

## Series engine

`Series<T>` stores committed values and supports Pine-style historical offsets: `at(0)` is the current value and `at(1)` is the previous value. Indicator implementations should use incremental state where appropriate and avoid unnecessary whole-history rescans.

## Pine-specific invariants

- No future-bar reads.
- No implicit `na` coercion.
- Historical and realtime execution remain distinguishable.
- Realtime rollback restores committed `var` state while preserving `varip` behavior.
- Current realtime bar replacement invalidates affected incremental indicator state.
- Independent runtimes must not share mutable execution state.

## Multi-timeframe requests

`request.*` will resolve independent symbol/timeframe execution contexts and align results to the caller's context. Lookahead, gaps, confirmation, and lower-timeframe intrabars are explicit runtime concepts.

## Strategies

`strategy.*` expresses order intent. A broker interface performs fills. Backtesting uses a deterministic Pine-style emulator; paper and live brokers are separate adapters.

## Visuals

Plots and drawing objects emit renderer-neutral events. Chart packages consume those events through adapters, keeping the runtime usable in non-browser trading bots.

## TA implementation boundary

Each TA built-in should have a small public API surface and an isolated implementation. Shared numerical primitives belong in reusable internal helpers only when Pine semantics are genuinely shared.

Every built-in requires tests for numerical output, warm-up, `na`, history, and realtime behavior where applicable. Multi-return Pine built-ins should use explicit typed tuple/result contracts rather than loosely typed arrays or objects.
