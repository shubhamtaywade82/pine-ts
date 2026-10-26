# pine-ts

Pine Script v6-inspired trading runtime for TypeScript.

`pine-ts` is designed to let TypeScript trading bots use a Pine-like API (`ta.*`, `math.*`, `request.*`, `strategy.*`, series/history semantics, bar state, plotting, alerts, and collections) while obtaining market data through pluggable providers. Binance is the first-class provider via `@nemesis-oss/binance-sdk`.

## Project status

**Broad v6 surface, expanding verification depth.** The runtime contracts,
the deterministic series/technical-analysis core, and the full `ta.*`
namespace (67/67 manifest symbols, 0 `planned`) are implemented, along with
`math.*`, `array.*`, `matrix.*`, `map.*`, `str.*`, `color.*`, `input.*`,
`log.*`, global built-ins (`alert`, `timestamp`, type casts), `syminfo.*`,
`ticker.*` (Heikin-Ashi / Renko / Kagi / Line Break / Point & Figure
builders), a multi-context `request.security` / `request.security_lower_tf`
engine (with `gaps`/`lookahead` semantics), a `strategy.*` engine with
broker emulator plus a live/paper `BrokerAdapter` boundary (incl. a
`MockBinanceTradingSurface` reference implementation), a renderer-neutral
visual event stream with drawing objects, and a `ChartAdapter` that
serializes the visual event stream to SVG (or a list of typed primitives
for a Canvas host). The v6 constants namespace ships 47 named-constant
records (`barmerge`, `dayofweek`, `currency`, `barstate`, `syminfo_type`,
`months`, `frequency`, `display_extended`, `plot_freq`, `earnings`,
`quandl`, `economic`, `volumetype`, `text_align`, `text_wrap`,
`text_font_family`, `cell_border`, `tooltip`, `event`,
`strategy_direction`, `strategy_evaluations`, `chart`, `linefill`, etc.).

The running-sum kernel (`src/ta/running-sum.ts`, ported from OakScriptJS's
MIT `RunningSum`) backs `math.sum` / `ta.sma` / `ta.stdev` / `ta.variance`
/ `ta.mfi` and matches PineScript bit-for-bit on the reference vectors
(cancellation residues, resync just below a power of two, series-length
changes, na/Infinity skipping) — see
`tests/reference-pine-vectors-running-sum.test.ts`.

The `wmaAdd` partial-sum kernel (ported from OakScriptJS's MIT `wmaAdd`)
backs `ta.wma` and matches PineScript bit-for-bit on the 21-bar
cancellation-residue vector, the 1e-10 threshold vectors, and the
tiny-values vector — see `tests/reference-pine-vectors-wma.test.ts`.

## Writing indicators and strategies

`indicator()` and `defineStrategy()` take a Pine-shaped body that runs once
per bar. Price series, `ta`, `math`, `input`, `plot`, and `hline` arrive as
arguments — no context types, input bags, result objects, or `.at(0)`.

```ts
import { defineStrategy, indicator, ta } from "@nemesis-oss/pine-ts";

export const rsi = indicator("RSI", ({ close, input, plot, hline }) => {
  plot(ta.rsi(close, input.int(14, "Length", { min: 1 })), "RSI");
  hline(70);
  hline(30);
});

export const smaCross = defineStrategy(
  "SMA Cross",
  { initial_capital: 10_000, default_qty_value: 1 },
  ({ close, input, strategy }) => {
    const sma = ta.sma(close, input.int(20, "Length"));
    strategy.entry("Long", "long", { when: ta.crossover(close, sma) });
    strategy.close("Long", { when: ta.crossunder(close, sma) });
  },
);

const { values, plots, inputs } = await rsi.run(bars, { inputs: { Length: 21 } });
const { trades, equity, engine } = await smaCross.backtest(bars);
```

Rules (all enforced, none silently coerced):

- Inputs are keyed by title. Overrides are validated (integer, `min`/`max`,
  `options`, source selector); unknown override titles throw.
- `plot()`/`hline()` must run unconditionally on every bar, as in Pine.
  Plot ids come from titles (`plot_<n>` when untitled). `na`/NaN → `undefined`.
- `ta.crossover(...)` returns a `BooleanSeries` (an object, always truthy).
  Pass it as `when`, or use `.value` inside `if`.
- `strategy.entry` without `qty` uses `default_qty_value` only for `"fixed"`
  sizing; other sizing types require an explicit `qty`.
- `strategy.exit("SL/TP", { from_entry: "Long", stop, limit })` places a
  bracket: `stop`/`limit` are prices, `profit`/`loss` are ticks (pass
  `backtest(bars, { mintick })`). The first leg to fill cancels the other;
  without `qty` the whole trade exits. Fills follow Pine's intrabar path
  (open→high→low→close when the open is nearer the high) and a gapped-through
  level fills at the open.
- `backtest()` runs confirmed bars only; the strategy engine has no realtime
  rollback. Indicators support realtime via `bind()` + `PineRuntime.runRealtime`.
- `ctx` (full `PineContext`) and `strategy.engine` remain available as escape
  hatches. Semantics are identical to the low-level runtime (parity-tested in
  `tests/script-authoring.test.ts`).

## Indicator registry (Wave 13)

A declarative metadata model for indicators and strategies, mirroring
lightweight-charts-indicators' `inputConfig` / `plotConfig` / `metadata` /
`calculate` shape so a chart workbench UI can list + configure + render
any indicator generically.

- `src/registry/types.ts` — `InputConfig` (int/float/bool/string/source/
  color/timeframe/symbol/session/resolution), `PlotConfig` (line/histogram/
  marker/hline/fill_band/bgcolor/barcolor/candle/bar/area), `Indicator`
  interface, `IndicatorRegistry` interface.
- `src/registry/define.ts` — `intInput`, `linePlot`, `defineIndicator`, ...
  factories so an indicator definition reads like a declarative spec.
- `src/registry/helpers.ts` — `resolveSource` (open/high/low/close/hl2/hlc3/
  ohlc4), `readNumber` / `readBoolean` / `readString` type guards.
- `src/registry/registry.ts` — `getIndicatorRegistry`,
  `registerIndicator`, `resetIndicatorRegistry`. `instantiate(id, inputs)`
  returns an `IndicatorInstance` whose `run(bars)` async-generator drives
  the indicator's `calculate` bar-by-bar against the pine-ts runtime and
  yields one `IndicatorResult` (plotId → value) per bar.
- `src/registry/indicators/` — 6 built-in indicators self-register on
  module import: `sma`, `ema`, `rsi`, `macd`, `bb`, `obv`. Each is a thin
  TypeScript wrapper around the pine-ts runtime (`ta.sma`, `ta.ema`,
  `ta.rsi`, `ta.macd`, `ta.bb`, `ta.obv`).

Usage:

```ts
import { registry } from "pine-ts";
import "pine-ts/registry/indicators"; // self-registers built-ins

for (const meta of registry.list()) {
  console.log(meta.id, meta.name, meta.category); // sma, ema, rsi, macd, bb, obv
}

const instance = registry.instantiate("rsi", { length: 14 })!;
for await (const result of instance.run(bars)) {
  console.log(result.main); // the RSI value at each bar
}
```

Future waves (14+) build the chart workbench (Next.js + lightweight-charts
v5), the live Binance broker wiring (mainnet behind a flag), the alert
delivery sinks (webhook + Telegram + email + broker action), and the
Pine editor (TypeScript-first, Monaco + hot-reload).

Verification status per `ta.*` symbol is tracked in
[`docs/TA-COVERAGE.md`](docs/TA-COVERAGE.md); functions with
PineScript-exported reference vectors are marked `verified`
(`tests/reference-pine-vectors.test.ts` and
`tests/reference-pine-vectors-running-sum.test.ts` pin several
bit-for-bit — see [`docs/ECOSYSTEM.md`](docs/ECOSYSTEM.md) for the audit
and provenance).

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
- DhanHQ (NSE/BSE) integration through `@nemesis-oss/dhanhq-sdk`.
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

### DhanHQ (NSE/BSE)

```ts
import { DhanClient } from "@nemesis-oss/dhanhq-sdk";
import { DhanHQProvider, PineRuntime } from "@nemesis-oss/pine-ts";

const client = DhanClient.fromEnv();
const provider = new DhanHQProvider({
  charts: client.charts,
  instruments: client.instruments,
  feed: client.ws.market,
});
await client.ws.connect(); // the caller owns the socket

// Symbols are "<exchangeSegment>:<securityId>" composite keys.
const runtime = new PineRuntime({ provider, symbol: "IDX_I:13", timeframe: "15" });
await runtime.run(script);
await runtime.runRealtime(script);
```

Bars are anchored to the session open (NSE 09:15 IST), matching TradingView.
Historical minute bars are built from 1-minute candles and realtime bars from
trade ticks with the same bucketing, so both agree on bar boundaries. A bar
closes on the first tick of the next bucket or `closeGraceMs` after its bucket
ends.

Neither SDK is a runtime dependency: the providers consume their surfaces
structurally, and the tests type-check the real SDK classes against them.

### Community scripts

`community.*` holds faithful ports of open-source TradingView scripts, checked
bar for bar against a literal transcription of the published Pine source.

```ts
import { community, ta } from "@nemesis-oss/pine-ts";

const script: PineScript = (ctx) => {
  // Machine Learning Adaptive SuperTrend [AlgoAlpha]
  const st = community.mlAdaptiveSupertrend({ atrLength: 10, factor: 3, trainingPeriod: 100 });
  const bullish = ta.crossunder(
    st.direction,
    ctx.series("zero", () => 0),
  ).value;
};
```

`direction` follows Pine's SuperTrend convention: -1 is an uptrend, 1 a
downtrend.

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

MIT, except `src/community/ml-adaptive-supertrend.ts`, a port of AlgoAlpha's
"Machine Learning Adaptive SuperTrend", which stays under the Mozilla Public
License 2.0 of the original script (see the file header). The package license
is therefore `MIT AND MPL-2.0`.
