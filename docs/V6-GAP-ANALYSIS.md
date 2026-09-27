<!-- cspell:words alertcondition backadjustment barmerge closedtrades fixnan heikinashi hlcc isfirstbar islastbar ismarket ispostmarket ispremarket kagi maxval minmove minval netprofit opentrades plotarrow plotbar plotcandle plotchar plotshape pointfigure pointvalue pricescale quandl renko timenow tostring tradingday volumetype wvad xloc yloc -->

# Pine Script v6 gap analysis

Audit date: 2026-09-27, against `main` at `549e595`.

Denominator: the official [Pine Script v6 Reference Manual](https://www.tradingview.com/pine-script-reference/v6/) symbol index, captured in [`api-manifest/v6-reference-index.json`](../api-manifest/v6-reference-index.json). Semantics references are the [Pine Script v6 User Manual](https://www.tradingview.com/pine-script-docs/) pages (execution model, time series, `var`/`varip`, realtime, repainting, other timeframes and data, strategies, visuals).

## Verdict

`pine-ts` has a solid **analytical kernel**: series history, realtime rollback/commit, `var`/`varip`, `barstate.*`, most of `ta.*`, and all of `math.*`, `array.*`, `map.*`, `matrix.*`. Everything a script **produces** (plots, drawings, alerts, strategy orders) and everything it **requests** (`request.*`, `input.*`) is still missing, along with the `str.*`, `color.*` and `log.*` utility namespaces.

Measured against the manual, roughly **40% of built-in functions** exist (mostly `ta`/`math`/collections), and **none** of the visual, strategy, request, input, string or color surface does.

The bigger blocker for writing Pine-equivalent logic in TypeScript is not the missing functions but **six execution-model gaps** (section 3). The main one is that state identity is keyed by argument values or user-supplied strings rather than Pine call sites. That gap sets the TypeScript authoring model, so decide it before building the strategy or visual engines on top.

## 1. Coverage by reference category

| Category (reference manual) | Total | Present | Notes                                                                                                                                   |
| --------------------------- | ----: | ------: | --------------------------------------------------------------------------------------------------------------------------------------- |
| Functions                   |   475 |    ~188 | `ta` 47/59, `math` 24/24, `array` 55/55, `matrix` 49/49, `map` 11/11, `timeframe` 2/3, global 2/41                                      |
| Variables                   |   161 |     ~30 | OHLCV/`hl2`/`hlc3`/`ohlc4`, `bar_index`, `barstate.*` (7/7), 7/10 `ta.*` vars as functions, partial `syminfo`                           |
| Constants                   |   239 |       4 | only `math.e/pi/phi/rphi`                                                                                                               |
| Types                       |    20 |       6 | `int/float/bool` (as `number`/`boolean`), `array`, `map`, `matrix`; no `color`, drawing types, `chart.point`, `footprint`, `volume_row` |
| Keywords / language         |    16 |       2 | `var`, `varip` through `PineState`; see section 3 for UDTs, methods, enums, `import`/`library`                                          |

### Function coverage per namespace

| Namespace                                                              | Implemented | Missing                                                                                               |
| ---------------------------------------------------------------------- | ----------: | ----------------------------------------------------------------------------------------------------- |
| `ta.*`                                                                 |       47/59 | `alma cci cog correlation max median min mode pivot_point_levels range rci tsi`                       |
| `ta.*` variables                                                       |        7/10 | `ta.iii`, `ta.wad`, `ta.wvad`                                                                         |
| `math.*`                                                               |       24/24 | —                                                                                                     |
| `array.*`                                                              |       55/55 | generic `array.new<type>` maps to `new_float/int/...`; drawing-typed arrays wait on the drawing types |
| `matrix.*`                                                             |       49/49 | —                                                                                                     |
| `map.*`                                                                |       11/11 | —                                                                                                     |
| `timeframe.*`                                                          |         2/3 | `timeframe.change`; the `timeframe.*` variables are not on `PineContext`                              |
| global                                                                 |        2/41 | see section 4.1                                                                                       |
| `str.*`                                                                |        0/18 | entire namespace                                                                                      |
| `color.*`                                                              |         0/7 | entire namespace + 17 color constants                                                                 |
| `input.*`                                                              |        0/13 | entire namespace (+ `input()`)                                                                        |
| `request.*`                                                            |        0/11 | entire namespace                                                                                      |
| `ticker.*`, `syminfo.*` fns                                            |        0/11 | entire namespace                                                                                      |
| `strategy.*` (+ `closedtrades`, `opentrades`, `risk`)                  |        0/47 | entire namespace + 49 `strategy.*` variables + 14 constants                                           |
| `line`, `label`, `box`, `table`, `linefill`, `polyline`, `chart.point` |       0/105 | entire visual object model                                                                            |
| `log.*`, `runtime.error`                                               |         0/4 | entire namespace                                                                                      |
| `footprint.*`, `volume_row.*`                                          |        0/17 | provider-limited; needs a tick/volume-profile data contract                                           |

## 2. What is solid today

- `Series<T>` committed/working state machine, history offsets, and reverse-order commit (docs/SEMANTICS.md, invariants I1–I4).
- Realtime tick rollback. Unconfirmed bars vanish on the next bar. `var` rolls back, `varip` persists.
- `PineState` `var`/`varip` cells, including stateful collection values (`_commit`/`_rollback` delegation).
- Runtime-scoped `NodeRegistry` (no module-level indicator caches).
- `ta.*`: 47 functions with golden fixtures. Only `sma`, `ema`, `highest`, `lowest`, `change`, `crossover` and `crossunder` are `verified` against TradingView output. The other 40 are `draft`.
- Full `math`, `array`, `matrix` and `map` namespaces.
- 305 passing tests. `typecheck` and `manifest:validate` are clean.

## 3. Execution-model gaps (blockers for "TypeScript instead of Pine")

These gaps are ordered by how much downstream work depends on them. Resolve each one before building namespaces on top of it.

### 3.1 Call-site state identity

Pine allocates independent state per **call site**, including calls inside user functions, which get a separate instance per call site of the enclosing function. `pine-ts` identifies:

- TA nodes by `nodeKey(name, ...args)`, so two identical `ta.ema(close, 14)` calls share one node, and
- `var`/`varip` cells by a user-supplied string name (`state.var("x", ...)`), so the same name inside a helper called twice shares one cell.

Sharing TA nodes happens to be harmless for pure series functions. For `var`/`varip` it is wrong: a user function in Pine gets one `var` instance per call site. TypeScript has no call-site hook, so the options are:

1. a TypeScript transformer (tsdown/rolldown plugin) that injects a stable call-site ID into every `ta.*`, `state.var` and user-function call; or
2. an explicit scope API (`ctx.scope("name", fn)`) that prefixes keys, as a manual fallback.

Recommended: ship option 2 as the runtime primitive, and later add option 1 as a build-time plugin that emits option 2 calls.

### 3.2 Conditional execution of stateful calls

Pine evaluates a `ta.*` call only on bars where its branch executes. That is why the compiler warns when a TA call sits inside an `if`, and why `ta.ema` inside an `if` produces different values from an unconditional one. `Series` commits every registered node on every bar ("the node's evaluation at commit time"), so a TA call inside a conditional behaves as if it were unconditional. This silently diverges from Pine for any script that relies on conditional TA. The current behavior should become opt-in, with Pine behavior as the default.

### 3.3 Dynamic (`series int`) lengths

v6 accepts `series int` `length` for most `ta.*` functions. `length` is currently part of the node key, so a changing length creates a fresh node with a cold warm-up on each change. Pine instead recomputes the window over existing history. Each function needs a variable-length path, or the change must be rejected explicitly.

### 3.4 `na` representation

`na` is exported as `NaN` (`src/core/na.ts`), while series and `PineValue<T>` use `undefined`. Two representations of `na` let `NaN` leak into arithmetic and comparisons (`NaN !== NaN`; `isNa` masks the split, but raw `===` comparisons and `Series<number>` consumers do not). Pick one canonical representation, preferably `undefined` for series values, and make `na`/`nz`/`fixnan` agree with it. `fixnan` is missing.

### 3.5 Bounded history (`max_bars_back`)

`Series.committedValues` grows without bound, and every node's history does too. A long-running realtime bot will leak memory. Pine buffers are bounded (default 5000 bars for built-in-referenced series, with a `max_bars_back()` override). A ring buffer with explicit per-series or per-script limits is needed before production realtime use.

### 3.6 Script declaration and TypeScript authoring surface

- There is no `indicator()`, `strategy()` or `library()` declaration object carrying `overlay`, `max_bars_back`, `calc_on_every_tick`, `process_orders_on_close`, `timeframe`, and so on.
- `RuntimeOptions.executionMode` is declared but never read.
- There are no series arithmetic helpers. Every derived value needs `ctx.series(key, fn)` with a hand-written key. Needed: typed helpers such as `add`, `sub`, `mul`, `div`, `gt`, `iff` and `nzs` over `number | Series<number>`, following Pine's rule that scalars promote to series.
- Pine's type-qualifier model (`const`, `input`, `simple`, `series`) is not represented in TypeScript types. Branded types could enforce "`length` must be `simple int`" at compile time.
- User-defined types (`type`), `method`, `enum` and `import`/`library` have natural TypeScript equivalents (classes, functions, `const` objects, ES modules). They need documented conventions, especially for how UDT fields declared with `varip` roll back, not new runtime machinery.

## 4. Missing surface, by area

### 4.1 Global built-ins

| Kind      | Missing                                                                                                                                                                                                                                                                                                                                                  |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Functions | `fixnan`, `time()`, `time_close()`, `timestamp()`, `max_bars_back`, `bool/int/float/string/color/label/line/box/table/linefill` casts, `alert`, `alertcondition`, `plot*`, `hline`, `fill`, `bgcolor`, `barcolor`, `indicator`, `strategy`, `library`, `input`                                                                                           |
| Variables | `hlcc4`, `time_close`, `time_tradingday`, `timenow`, `last_bar_time`, `ask`, `bid`, `dayofmonth/dayofweek/hour/minute/month/second/weekofyear/year` as current-bar variables                                                                                                                                                                             |
| Constants | `barmerge.*`, `dayofweek.*`, `session.*`, `adjustment.*`, `backadjustment.*`, `settlement_as_close.*`, `currency.*` (56), `order.*`, `alert.*`, `display.*`, `format.*`, `plot.*`, `shape.*`, `location.*`, `size.*`, `text.*`, `font.*`, `extend.*`, `xloc/yloc.*`, `position.*`, `scale.*`, `hline.*`, `line.style_*`, `label.style_*`, `color.*` (17) |

### 4.2 Time and session

- The calendar functions live under a non-Pine `time.*` namespace, use **UTC only**, and have no `timezone` parameter. Pine defaults to `syminfo.timezone`, so on NSE (`Asia/Kolkata`) every `hour`/`dayofweek` result is wrong.
- When the timestamp is omitted they read `Date.now()`, which breaks determinism. The Pine equivalent is the current bar's `time`.
- `weekofyear` implements ISO-8601 weeks. This has not been verified against Pine.
- Missing: `session.*` variables (`isfirstbar`, `islastbar`, `ismarket`, `ispremarket`, `ispostmarket`, and so on), session-string parsing, and `time(timeframe, session, timezone)` session filtering. NSE workloads (09:15–15:30 IST) depend on all of these.
- `timeframe.*` variables exist in `time.parse()` output but are not exposed on `PineContext`. `timeframe.main_period` and `timeframe.change()` are missing.

### 4.3 `syminfo.*`

About 8 of the 40 variables are present, under camelCase names (`minTick`, `baseCurrency`, …). Missing Pine names include `mintick`, `pointvalue`, `pricescale`, `minmove`, `session`, `volumetype`, `root`, `prefix`, `main_tickerid`, and `current_contract`. The fundamentals fields (`employees`, `shares_outstanding_*`, `recommendations_*`, `target_price_*`, …) must become typed provider-capability errors.

### 4.4 `request.*` (Phase 4, not started)

`security` and `security_lower_tf` need secondary-context execution, `barmerge.gaps_*`/`lookahead_*`, confirmed-HTF (non-repainting) alignment, and cache keys of the form `(symbol, timeframe, expression, options)`. Everything else is provider-limited: `financial`, `dividends`, `splits`, `earnings`, `economic`, `quandl`, `seed`, `currency_rate`, `footprint`, plus `dividends.*` and `earnings.*` future variables. `ticker.*` (`new`, `modify`, `heikinashi`, `renko`, `kagi`, `linebreak`, `pointfigure`, `standard`, `inherit`) is also missing. Non-standard chart types need synthetic bar builders.

### 4.5 `strategy.*` (Phase 6, not started)

- Orders: `entry`, `order`, `exit`, `close`, `close_all`, `cancel`, `cancel_all`.
- Risk: `strategy.risk.*` (6 functions).
- Trade collections: `closedtrades.*` (18 functions) and `opentrades.*` (13 functions).
- State: 49 `strategy.*` variables (equity, netprofit, drawdown, position fields, …).
- Broker emulator semantics:
  - fill on the next bar open, or on close with `process_orders_on_close`;
  - intrabar OHLC path assumption;
  - `calc_on_order_fills`, pyramiding, OCA groups, commission and slippage models;
  - margin and liquidation;
  - currency conversion.

For live use, a broker-adapter boundary equivalent to `MarketDataProvider` is also needed, covering order rejection, partial fills, stale-quote guards and a kill switch.

### 4.6 Visual and object runtime (Phase 5, not started)

- Drawing objects: `plot`, `plotshape`, `plotchar`, `plotarrow`, `plotbar`, `plotcandle`, `hline`, `fill`, `bgcolor`, `barcolor`, and the `line`/`label`/`box`/`table`/`linefill`/`polyline`/`chart.point` object models (105 functions).
- Object lifecycle: `*.all` arrays, and garbage collection capped by `max_lines_count`, `max_labels_count` and `max_boxes_count`.
- Realtime rollback of drawings.
- A renderer-neutral event stream.
- `chart.*` variables.

For a headless trading runtime, `plot` and `alertcondition` still matter because they are the signal outputs. The drawing objects matter because scripts read them back (`line.get_price`, `box.get_top`).

### 4.7 Utility namespaces

- `str.*` (18 functions), including `str.format` with ICU message-format semantics and `str.tostring` with `format.*` constants.
- `color.*`: `new`, `rgb`, `r`, `g`, `b`, `t`, `from_gradient`, and the 17 constants.
- `input.*`: 13 functions. In a TypeScript library these reduce to typed parameters with defaults, `minval`/`maxval`/`options` validation, and metadata for UIs.
- `log.*` and `runtime.error`.

## 5. Defects and inconsistencies in existing code

| Location                                    | Issue                                                                                                                                                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/core/context.ts` `last_bar_index`      | Set to the **current** `session.barIndex`. Pine's `last_bar_index` is the final historical bar's index on every bar. The JSDoc states the Pine semantics, but the code does not implement them.       |
| `src/core/session.ts` `processRealtimeTick` | A first realtime tick whose `time` equals the last (already confirmed) historical bar is treated as an intrabar update of a committed bar. The "last historical bar still open" hand-off is untested. |
| `src/time/calendar.ts`                      | UTC-only with no timezone parameter, and a `Date.now()` default (see 4.2).                                                                                                                            |
| `src/core/na.ts`                            | Dual `na` representation, `NaN` versus `undefined` (see 3.4).                                                                                                                                         |
| `src/core/runtime.ts`                       | `RuntimeOptions.executionMode` is unused. `this.currentBar!` uses a non-null assertion, which AGENTS.md discourages.                                                                                  |
| `src/core/series.ts` `Series.nextId`        | A static, process-global counter feeds `nodeKey`. Keys stay deterministic within one runtime but depend on construction order across runtimes.                                                        |
| `src/data/binance.ts`                       | A pass-through interface. No `@nemesis-oss/binance-sdk` mapping exists (Phase 0 item still open).                                                                                                     |
| `api-manifest/ta.v6.json`                   | Lists 10 names that are **not** v6 built-ins: `aroon bop dema ichimoku tema trima trix relativeVolume sum avg`. Omits 4 that are: `pivot_point_levels rci wad wvad`.                                  |
| `docs/ROADMAP.md`                           | Phase 3 does not tick `array`, `matrix` or `map`, although all three namespaces are fully exported.                                                                                                   |

## 6. Recommended order of work

1. **Kernel corrections** (small, high leverage): fix `last_bar_index`; unify `na`; add `fixnan`; make calendar functions timezone-aware and bar-time-driven; bound history with a ring buffer; correct `ta.v6.json` against the reference index.
2. **Call-site scoping and conditional-execution semantics** (3.1, 3.2). These define the TypeScript authoring model, so everything after this depends on them.
3. **Series arithmetic helpers and a script declaration object** (3.6).
4. **Remaining `ta.*`**: `alma cci cog correlation max min median mode range rci tsi pivot_point_levels`, the `iii`/`wad`/`wvad` variables, and variable-length support. Then promote the `draft` functions to `verified` with TradingView-exported vectors.
5. **`str.*`, `color.*`, `input.*`, `log.*`**: pure and quick. They unblock `plot`/`alert` payloads.
6. **Time and sessions**: `session.*`, `time()` with a session filter, `timeframe.*` on the context, and `timeframe.change`.
7. **`request.security` / `security_lower_tf`**: secondary-context execution with non-repainting defaults.
8. **Strategy engine and broker emulator**, then paper/live broker adapters.
9. **Outputs**: `plot*`, `alertcondition`/`alert`, then the drawing object model with rollback.
10. **Provider-limited surface**: typed capability errors for fundamentals, `footprint` and `volume_row`.
11. **Optional**: a Pine source transpiler (Phase 7) that targets the scoped runtime from step 2.

## 7. Reproducing this audit

The reference index is extracted from the element anchors of the rendered reference page (`fun_*`, `var_*`, `const_*`, `type_*`, `kw_*`, `op_*`, `an_*`). To reproduce the per-namespace diff, compare `api-manifest/v6-reference-index.json` `functions` against the named exports of `src/{ta,math,array,map,matrix,time}/*.ts`. Re-capture the index when TradingView publishes reference changes.
