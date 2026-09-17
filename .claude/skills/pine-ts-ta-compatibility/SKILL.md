# Pine-TS TA Compatibility Skill

Use this skill whenever adding or changing a Pine Script technical-analysis built-in.

## Goal

Produce behavior compatible with Pine Script v6, including numerical output and execution semantics.

## Procedure

1. Locate the existing series/state abstractions and current TA implementation style.
2. Verify the built-in in the TradingView Pine v6 Reference Manual.
3. Record the exact signature, argument qualifiers, return shape, warm-up requirements, and `na` behavior.
4. Write deterministic failing tests using explicit OHLCV/series fixtures.
5. Cover insufficient history, length edge cases, `na`, history offsets, and representative numerical values.
6. Cover realtime open/update/close behavior when the function maintains state.
7. Cover two independent runtimes to detect cache/state leakage.
8. Implement the smallest correct algorithm. Keep mathematical kernels pure where possible.
9. Use explicit incremental state only when required for streaming performance or Pine semantics.
10. Differential-test against Pine reference output whenever a reference fixture can be generated.
11. Update `api-manifest/ta.v6.json`, generated inventory, exports, and `docs/TA-COVERAGE.md`.
12. Run targeted tests, then `pnpm check` and `pnpm build` for public API changes.

## Design guidance

- Prefer Strategy for pluggable algorithms, Memento for rollback snapshots, Adapter for external data providers, and Factory for interchangeable state/cache implementations.
- Do not create a class merely to wrap a single arithmetic formula.
- Do not use global mutable Maps/Sets to retain runtime or series state.
- Do not silently coerce `undefined`/`na` to zero.
- Do not use another TA package as the compatibility oracle.

## Completion criteria

A TA implementation is not complete merely because its formula looks correct. It is complete only when its Pine-facing signature, numerical behavior, warm-up/`na` behavior, realtime behavior, state isolation, tests, exports, inventory, and documentation are aligned.
