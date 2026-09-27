# pine-ts

Pine Script v6-inspired trading runtime for TypeScript.

`pine-ts` is designed to let TypeScript trading bots use a Pine-like API (`ta.*`, `math.*`, `request.*`, `strategy.*`, series/history semantics, bar state, plotting, alerts, and collections) while obtaining market data through pluggable providers. Binance is the first-class provider via `@nemesis-oss/binance-sdk`.

## Project status

Early foundation. The repository is intentionally starting with the runtime contracts and deterministic series/technical-analysis core before implementing the full Pine v6 surface.

## Goals

- Pine v6-compatible developer ergonomics where practical.
- Deterministic historical bar-by-bar execution.
- Realtime execution with explicit confirmed/unconfirmed bar state.
- History references such as `close[1]`.
- Incremental indicator state rather than repeated whole-array scans.
- `request.security()`-style multi-symbol/timeframe contexts.
- Strategy/backtest/paper/live broker separation.
- Chart/rendering adapters independent of the runtime core.
- Binance REST/WebSocket integration through `@nemesis-oss/binance-sdk`.
- Machine-readable API manifest to track Pine reference coverage.

## Non-goals

`pine-ts` does not pretend Binance can provide every TradingView dataset. Provider-specific capabilities will be explicit errors rather than fabricated values.

## Architecture

```text
Trading Bot
   |
   v
@nemesis-oss/pine-ts
   |
   +-- Core runtime / execution / series / state
   +-- ta.* / math.* / collections / strings / colors
   +-- request.* / timeframe / sessions
   +-- strategy.* / broker interface / backtesting
   +-- plotting / drawing / alerts
   |
   +--> BinanceProvider --> @nemesis-oss/binance-sdk
   |
   +--> Renderer adapters
```

## Usage

```ts
import { BinanceClient } from "@nemesis-oss/binance-sdk";
import { BinanceProvider, PineRuntime, ta, type PineScript } from "@nemesis-oss/pine-ts";

const client = new BinanceClient();
const provider = new BinanceProvider({ market: client.spot.market, socket: client.spot.ws });
const runtime = new PineRuntime({ provider, symbol: "BTCUSDT", timeframe: "15" });

const script: PineScript = (ctx) => {
  const fast = ta.ema(ctx.close, 9);
  const slow = ta.ema(ctx.close, 21);
  // Each ctx.scope id is an independent Pine call site with its own state.
  const trend = ctx.scope("trend", () => ta.sma(ctx.close, 50));
  if (ctx.barstate.isconfirmed && ta.crossover(fast, slow).value) {
    console.log("cross up", ctx.close.value, trend.value);
  }
};

await runtime.run(script); // historical bars; a still-forming last kline runs as the open realtime bar
await runtime.runRealtime(script); // continues on the kline stream
```

`@nemesis-oss/binance-sdk` is not a runtime dependency: `BinanceProvider`
consumes its market surfaces structurally.

## Development

Requires Node.js 22+.

```bash
corepack enable
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

## Examples

Runnable examples use local sample data and do not require exchange credentials:

```bash
pnpm exec tsx examples/historical-sma-crossover.ts
pnpm exec tsx examples/realtime-bar-updates.ts
pnpm exec tsx examples/simple-backtest-loop.ts
pnpm exec tsx examples/rsi-momentum-filter.ts
```

The first example detects SMA crossover signals from historical bars. The second
shows how repeated updates to a realtime bar are evaluated before confirmation.
The third runs a simulated trade backtest tracking cash, positions, and net PnL.
The fourth demonstrates combining an RSI oscillator with an EMA trend filter.

## Roadmap

See [`docs/ROADMAP.md`](docs/ROADMAP.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/SEMANTICS.md`](docs/SEMANTICS.md), and [`docs/COMPATIBILITY.md`](docs/COMPATIBILITY.md). The runtime's execution semantics — series state machine, node rollback/commit contract, `var`/`varip` lifecycle, `na` model, and the four executable invariants (determinism, replay equivalence, truncation equivalence, chunk invariance) — are specified in [`docs/SEMANTICS.md`](docs/SEMANTICS.md).

## License

MIT
