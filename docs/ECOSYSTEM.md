# Ecosystem integration guide

How the surrounding open-source ecosystem fits into `pine-ts`, and what came
out of auditing it. Audit date: 2026-10-25, against `pine-ts@11a71aa` and
OakScriptJS v0.12.3 / lightweight-charts-indicators v0.16.8.

## The one-sentence policy

pine-ts stays the authoritative runtime; the ecosystem is used for
**reference vectors, algorithm cross-checks, and rendering targets** — never
as a second source of execution semantics, and never as a substitute for the
Pine v6 Reference Manual as the compatibility oracle.

## Repository-by-repository

### [OakScriptJS](https://github.com/deepentropy/oakscriptJS) — MIT, v0.12.3

**Highest-value find.** A Pine-v6-compatible computational library (batch
array functions + a `Series` class + a flat script API). Its inventory
claims 100% of the in-scope official namespaces (`ta`, `math`, `array`,
`matrix`, `str`, `color`, drawings), and — critically — **its test suite
contains full-precision PineScript-exported reference vectors** ("expected
values are PineScript outputs (full precision) for the same inputs"),
including carefully reverse-engineered floating-point behaviours (#114
compensated running sums, #136 partial-sum cancellation, #141 `ta.tsi`
range, #145 `ta.stoch` carry-forward).

**What we took from it (this audit already paid off):**

| pine-ts function | Before | After (verified against Pine output) |
| --- | --- | --- |
| `ta.ema` | seeded with the first source value, no warm-up | `na` until the `length`-th valid bar, seeds with `ta.sma` (Kahan running-sum order); recurrence `(v - prev) * alpha + prev` |
| `ta.rma` | plain-sum SMA seed, algebraic recurrence | Kahan-ordered SMA seed; recurrence `(v + (length-1) * prev) / length` |
| `ta.tsi` | `mom(source, longLength)` change, `x100` scale | `ta.change(source)` (1-bar) change, **ratio in [-1, 1]** — the v6 remark states the built-in is not percentage-scaled |
| `ta.stoch` | `na` on zero range / na source | **keeps the previous result** on zero range and na source; peak/valley windows skip na values |
| `ta.cci` | `na` on zero mean deviation | **keeps the previous CCI** on flat windows (1e-10 tolerance); a first flat window gives 0 |
| `ta.linreg` | newest-first accumulation, `(sumY - slope*sumX)/length` intercept | oldest-first `x = 1..length` accumulation, intercept `sumY/length - (slope*sumX)/length + slope` (the fitted value at x = 1) |

The corrected implementations now pass
[`tests/reference-pine-vectors.test.ts`](../tests/reference-pine-vectors.test.ts)
**bit-for-bit** against the PineScript-exported values (transcribed from
OakScriptJS's MIT-licensed tests, attribution in the file header). The old
`ta.ema` fixture had encoded an assumed seeding model — this is exactly the
"do not promote on mathematical plausibility" failure mode the coverage
policy warns about, caught only because someone had exported real values.

**Known remaining numerical gap (documented, deliberate):** Pine keeps a
*compensated (Kahan) running sum* for `math.sum` / `ta.sma` / `ta.stdev` /
`ta.variance` / `ta.mfi`, including a resync rule when the compensation
would be absorbed. pine-ts's EMA/RMA **seeds** use the Kahan chain (so
`ta.tsi` is bit-exact), but the rolling-window kernels still use plain
incremental sums, so `ta.sma`-family outputs can differ from Pine in the
last bits on cancellation-heavy windows (e.g. residues like
`-7.105427357601002e-15` where Pine's compensated sum yields a slightly
different tiny value). Porting OakScriptJS's `RunningSum` engine
(`src/ta/running-sum.ts`, MIT) into pine-ts's node architecture is the
follow-up; the reference vectors for it are in their
`tests/ta/running-sum.test.ts`.

**Boundary:** do not adopt their runtime (different model: batch arrays +
lazy Series vs pine-ts's session-scoped committed-history nodes with
rollback). Use it as (a) a reference-vector mine, (b) a second
implementation for differential tests, (c) the place to check
"what does Pine actually do here" hypotheses.

### [lightweight-charts-indicators](https://github.com/deepentropy/lightweight-charts-indicators) — MIT, v0.16.8

1713 indicators (117 standard + 1545 community + 45 candlestick patterns)
built **on top of** OakScriptJS (`oakscriptjs >=0.12.0 <0.13.0` peer dep —
pin exactly; the README's stated range is stale). Three distinct uses:

1. **Indicator catalog / registry model.** Each indicator ships
   `inputConfig` / `plotConfig` / `metadata` next to `calculate()`. This is
   the right shape for a future pine-ts workbench UI: typed inputs with
   defaults/min/max/tooltip, plot declarations with colors, overlay flag.
2. **Rendering reference.** Its `IndicatorResult` → renderer mapping
   (lines, boxes, labels, tables, markers, fills) is a concrete precedent
   for consuming pine-ts's renderer-neutral `VisualEvent` stream — the
   lightweight-charts adapter pine-ts still needs can mirror this layer.
3. **Algorithm discovery.** Community ports are candidates for pine-ts
   `community.*` (like `mlAdaptiveSupertrend`) — after license/provenance
   checks and bar-for-bar verification, never as built-ins.

**Boundary:** its calculations are batch (`Bar[] → IndicatorResult`) with
no realtime rollback/commit semantics; its outputs must not be piped into
the pine-ts runtime as if they were series-correct.

### [awesome-pinescript](https://github.com/pAulseperformance/awesome-pinescript)

Curated list. Use it to feed a **port pipeline**: script → Pine version
check → license check → required-runtime-features inventory (request.*,
drawings, strategy state) → port → bar-for-bar test → record in
`community.*` or examples. Treat every linked script's license individually;
a public TradingView page is not redistribution permission.

### [lightweight-charts-react-wrapper](https://github.com/trash-and-fire/lightweight-charts-react-wrapper)

Declarative React components over Lightweight Charts. Relevant only when
pine-ts grows a browser workbench; verify against **Lightweight Charts
v5** (series creation changed to `chart.addSeries(LineSeries, options)`,
markers moved to a plugin API) before adopting. pine-ts's core will stay
React-free; this would live in a thin app layer.

### [lwc-plugin-visible-price-range-util](https://github.com/SlicedSilver/lwc-plugin-visible-price-range-util)

Viewport-aware drawing behaviour (targets **v4.1.0** — needs migration for
a v5 chart). Borrow the *idea* for viewport-adaptive overlays only;
viewport state must never reach the trading engine (signals must not change
when the user zooms). License needs confirming before copying code.

### [awesome-tradingview](https://github.com/tradingview/awesome-tradingview)

Official curated index of the ecosystem around Lightweight Charts and Pine.
Use for periodic dependency/ecosystem review; entries are not all official
projects and none of it belongs in the runtime.

## Where each layer lives in pine-ts

```text
Research inputs (this audit):
  oakscriptJS reference vectors ──▶ tests/reference-pine-vectors.test.ts
  oakscriptJS implementations ───▶ differential checks vs src/ta/*
  lwc-indicators registry/render ─▶ future workbench UI + LWC adapter
  awesome lists ──────────────────▶ community.* port pipeline

Runtime (unchanged by all of the above):
  provider ─▶ session/series ─▶ ta.* ─▶ strategy/visual events ─▶ host
```

## Rules for importing anything from these repos

1. MIT license kept; attribution in the file header (see
   `tests/reference-pine-vectors.test.ts`).
2. Pine v6 Reference Manual + exported values remain the only oracles; a
   second library agreeing is corroboration, not verification.
3. Reference vectors may promote a function's status; an algorithm
   transcription alone may not.
4. No runtime code from OakScriptJS enters `src/` without being rewritten
   as a session-scoped node with rollback-correct state (the `kahanSum`
   seed helper in `src/ta/core.ts` is the pattern: ported arithmetic, not
   ported architecture).
