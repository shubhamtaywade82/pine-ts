# Pine-TS Runtime Semantics

This document is the normative specification of the pine-ts runtime's
execution model: the series model, the node state machine, the session
lifecycle, persistent variables, and the `na` model. The four invariants at
the end are the executable acceptance criteria — `tests/invariants.test.ts`
runs them over the full built-in corpus, and any change to the runtime must
keep them green.

## Two domains: series vs JavaScript values

Pine computation lives in a **series domain**: every expression has one value
per bar, and history offsets are first-class. JavaScript computation lives in
a **value domain**: a `const spread = fast - slow` style expression is a
number valid only for the current execution. TypeScript cannot overload
operators, so pine-ts makes crossing the boundary explicit instead of
implicit. `Series` deliberately implements **neither `valueOf` nor
`toString`**: an accidental `fast - slow` on raw series objects produces
`NaN`, never a silent current-bar snapshot.

| Concept                           | Meaning                                                             |
| --------------------------------- | ------------------------------------------------------------------- |
| `Series<T>`                       | Pine-like time series, one value per confirmed bar                  |
| `series.at(n)`                    | Historical access: the value `n` confirmed bars ago                 |
| `series.value` / `series.current` | Current execution snapshot (may be unconfirmed in realtime)         |
| `ctx.series(key, fn)`             | Runtime-owned derived/user series; `fn` re-evaluates every revision |
| JS local                          | Ephemeral value for the current execution only                      |
| `ta.*`                            | Runtime-owned derived series built from memoized nodes              |

The `ctx.series` capture rule: the evaluate closure captures its JavaScript
environment at creation (first bar), so JS locals inside the closure are
frozen at their bar-0 values. Series reads (`close.value`, `spread.at(1)`)
inside the closure always observe the current revision. Derive dynamic
values from series reads, never from captured locals.

## Series model

A `Series<T>` owns two layers of state:

- **Committed history** — an array of closed-bar values. This is what
  `at(offset > 0)` and `history()` expose. It only grows at bar
  confirmation and is bounded by `maxBarsBack` (see below).
- **Working value** — the current bar's not-yet-confirmed value, stamped
  with the session `workingRevision` it was computed at. Sources set it via
  pushes; derived series compute it lazily by evaluating their node the
  first time `at(0)` is read at a new revision.

Offset resolution:

- `at(0)` — the working value for the current revision; evaluates the node
  on demand if the revision advanced. For `FloatSeries` a missing value
  reads as `NaN` (`na`); for `BooleanSeries` as `false`.
- `at(n > 0)` — always committed history, never the working value. While
  the current bar is open, offset 1 is the previous confirmed bar. An
  unconfirmed realtime tick is never visible through a positive offset.
- Missing history reads as `undefined` (distinguishable from a computed
  `na`).

**Per-bar commit guarantee:** every session-owned series commits exactly one
value on every confirmed bar, so history offsets mean "n bars ago"
unconditionally and histories of different series stay index-aligned, the
same way Pine series indexing does. What is committed depends on whether the
series' call executed on the bar (see "Local scopes" below):

- executed (resolved through the node registry, or evaluated) — the working
  value if the script read it, otherwise the node's evaluation at commit
  time; the node's state advances;
- not executed — the last committed value is carried forward and the node's
  state does **not** advance.

**Bounded history (`max_bars_back`):** `RuntimeOptions.maxBarsBack`
(default and maximum 5000, Pine's largest buffer) bounds every series.
`at(n)` with `n > maxBarsBack` throws a `RangeError` — the equivalent of Pine
runtime error RE10143 — and `history()` retains at most `maxBarsBack + 1`
values. Built-in windows that would need more history raise the same error.

Standalone series (created without a session) have no commit lifecycle:
pushed values are immediately committed.

## Node model

Every derived series is backed by a `SeriesNode` participating in a
three-phase per-bar state machine:

```text
committed node state
       |
       v
evaluate()   working value   (once per revision; many per realtime bar)
       |
       v
rollback()   restore committed state   (realtime revision discarded)
       |
       v
evaluate()   new working value for the revised tick
       |
       v
commit()     promote working state   (bar confirmed)
```

The contract:

- `evaluate` MUST NOT permanently mutate committed state. It may read its
  own state (read-only view), series history, and its captured constants.
  Repeated evaluation with unchanged inputs must produce the same value.
- `commit` advances node state exactly once per confirmed bar and is only
  invoked by the session's confirmation step.
- `rollback` restores the node to its last committed state. The standard
  `IndicatorDef` pattern mutates state only inside `commit`, so committed
  state is never left and rollback is a no-op hook; nodes that keep working
  state must restore it explicitly.

Nodes are memoized in the session's `NodeRegistry` under a structural key
(active scope path, function name, operand series identities, parameter
values), so re-invoking `ta.ema(close, 9)` on a later bar returns the same
series instance with its state intact. Operand identity is by series object
identity, not by current value. Series ids are allocated per session, so keys
never depend on other runtimes in the process.

## Local scopes and call-site identity

Pine gives every written call its own local scope with independent state and
history, and a call's state and history advance only on bars where the call
executes (User Manual, "Time series in scopes"). pine-ts models both:

- **Execution.** Calling a `ta.*` function (or `ctx.series`) on a bar marks
  that node executed for the bar. A node whose call did not run — for
  example a `ta.ema` inside an `if` whose condition was false — commits its
  last value again and keeps its state, so a conditional `ta.ema` smooths
  over executed bars only, and `x.at(1)` after a skipped bar returns the value
  from the last call ("the last committed value as of the bar at the
  specified offset").
- **Identity.** TypeScript has no call-site identity, so identical calls
  share one node. Wrap a helper in `ctx.scope(id, fn)` to give it a distinct
  call site: `ta.*` nodes, `ctx.series` keys, and `var`/`varip` cells created
  inside `fn` are qualified by the scope path (scopes nest). Re-entering the
  same id — on later bars, or repeatedly in one bar like a Pine call inside a
  loop — resolves to the same state.
- **Windowed built-ins read argument history.** Windowed functions (`sma`,
  `wma`, `highest`, `stdev`, ...) compute over the argument series' bar
  history. For calls that execute on every bar (the pattern Pine's compiler
  requires to avoid its "should be called on each calculation" warning) this
  is exactly Pine. Inside conditional scopes Pine instead uses the call's own
  parameter buffer, which holds values from executed bars only; pine-ts does
  not model that per-parameter buffer.
- **`series int` lengths.** A new length creates a new node. Incremental
  `series int` built-ins (`sma`, `cmo`, `mfi`) seed that node from the
  argument's committed history, so the value equals a node that had run
  with that length all along — Pine's recomputation over history.
  `simple int` lengths (`ema`, `rma`, `rsi`, `atr`, ...) cannot change in
  Pine, so a changed length there is a script error that pine-ts does not
  detect.

## Session lifecycle

Historical execution processes each bar atomically:

```text
beginBar -> execute(script) -> confirmBar
```

Realtime execution interleaves:

```text
tick, older bar time            -> discarded ("out_of_order")
tick, same bar, bar confirmed   -> discarded ("bar_already_confirmed")
tick, new bar time, open bar    -> close open bar on its last update (below)
tick, new bar time              -> beginBar -> execute -> confirm if closed
tick, same bar time             -> revision++ -> rollback working state
                                    -> update sources -> execute -> confirm if closed
```

Discarded updates are reported through `RuntimeOptions.onDiscardedTick`;
committed history is immutable.

**Historical hand-off:** `run()` confirms every historical bar except a final
bar marked `isClosed: false`. That bar is still forming, so it executes as the
open realtime bar (`barstate.isrealtime`, not confirmed), the previous bar is
`barstate.islastconfirmedhistory`, and `runRealtime()` updates continue it.
`last_bar_index` is the dataset's last bar index on every historical bar and
the newest bar index once realtime bars arrive.

`confirmBar` commits series in **reverse registration order** (downstream
nodes first) so a node's commit-time reads still observe its dependencies'
working values for the closing bar, then commits `var` cells.

**Closing tick:** Pine executes every realtime bar one final time on its
closing tick with `barstate.isconfirmed` true, then commits it (User Manual,
"Executions on realtime bars"). When the feed moves to a new bar without an
explicit close (`isClosed: true`) for the open one, the open bar's last
received update is its closing tick: the session rolls back, re-executes that
update as confirmed, and commits before beginning the new bar. Realtime bars
therefore never disappear, and `bar_index` always matches committed history.

## var / varip lifecycle

Cell names are qualified by the active `ctx.scope` path.

- `ctx.state.var(name, init)` — a persistent cell that rolls back to its
  committed value on every realtime revision and promotes on bar
  confirmation. At bar open it equals the last confirmed bar's final value.
- `ctx.state.varip(name, init)` — a persistent cell that is never rolled
  back: intrabar updates persist immediately across ticks and bars.

## na model

- `na` for floats is `Number.NaN` — the single canonical na **value**.
  `undefined` is not a value: it only means "no history at this offset"
  (before the first bar or the series' first call). Pine does not
  distinguish the two, so always test with `isNa` (Pine `na()`), which
  treats both as na, never with `===`/`!==` (Pine forbids `== na` for the
  same reason). `nz` substitutes a fallback; `fixnan` carries the last
  non-na value forward.
- `FloatSeries.value`/`current` coerce missing values to `NaN`;
  `BooleanSeries` coerces to `false` (an `na` condition is not true).
- History offsets keep `undefined` so callers can distinguish missing
  history from a computed `na`.
- Built-ins propagate na: window functions (`sma`, `wma`, `highest`, ...)
  return `na` while any window member is `na`; recursive functions (`ema`,
  `rma`) hold `na` until seeded; cross functions return `false` when any
  operand is `na`.

## The four invariants

These are the acceptance criteria for the foundation. `tests/invariants.test.ts`
runs every scenario (warmup windows, recursive state, history indexing,
multi-series crosses, composed chains, stateful carry-forward, `var`,
user series) over every dataset at multiple tick groupings.

- **I1 — Determinism.** `run(data, config)` twice produces identical
  committed histories and final state.
- **I2 — Replay equivalence.** Historical execution equals realtime
  execution of the same bars split into intrabar ticks with rollback and a
  final commit — including recursive indicators and `var`. (`varip` is
  excluded by definition: it exists to observe intrabar state.)
- **I3 — Truncation equivalence.** A full dataset's committed history at
  bar N equals the history of the dataset truncated at N. Any divergence is
  accidental lookahead.
- **I4 — Chunk invariance.** For identical final bars, any tick grouping
  (1, 2, 3, 5 ticks per bar) produces identical committed state after the
  final commit.

## Deliberate non-goals

- No JavaScript operator overloading: `fast - slow` on series objects does
  not compile to a series; use `ctx.series` or `zipSeries`.
- No implicit series-to-number coercion: no `valueOf`/`toString` on
  `Series`.
- `barstate`-dependent scripts may legitimately differ between historical
  and realtime execution inside a bar; only the committed state at bar
  close is required to be replay-equivalent.
