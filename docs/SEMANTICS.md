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
  confirmation.
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
value on every confirmed bar — the working value if the script read it,
otherwise the node's evaluation at commit time. History offsets therefore
mean "n bars ago" unconditionally and histories of different series stay
index-aligned, the same way Pine series indexing does.

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
(function name, operand series identities, parameter values), so re-invoking
`ta.ema(close, 9)` on a later bar returns the same series instance with its
state intact. Operand identity is by series object identity, not by current
value.

## Session lifecycle

Historical execution processes each bar atomically:

```text
beginBar -> execute(script) -> confirmBar
```

Realtime execution interleaves:

```text
tick, new bar time    -> beginBar -> execute -> confirm if closed
tick, same bar time   -> revision++ -> rollback working state
                          -> update sources -> execute -> confirm if closed
```

`confirmBar` commits series in **reverse registration order** (downstream
nodes first) so a node's commit-time reads still observe its dependencies'
working values for the closing bar, then commits `var` cells.

**Unconfirmed-bar discard:** a realtime bar that never confirms leaves no
trace. When the next bar opens, all working state — series working values,
node working state, and uncommitted `var` mutations — rolls back to the last
committed state. The unconfirmed bar vanishes exactly like a bar that never
happened; this is what keeps realtime replay-equivalent to historical
execution.

## var / varip lifecycle

- `ctx.state.var(name, init)` — a persistent cell that rolls back to its
  committed value on every realtime revision and promotes on bar
  confirmation. At bar open it equals the last confirmed bar's final value.
- `ctx.state.varip(name, init)` — a persistent cell that is never rolled
  back: intrabar updates persist immediately across ticks and bars.

## na model

- `na` for floats is `Number.NaN`. `isNa` treats both `undefined` and `NaN`
  as na; `nz` substitutes a fallback.
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
