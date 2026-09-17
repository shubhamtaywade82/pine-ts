# Pine-TS TA Compatibility Skill

Use for every Pine Script TA implementation or semantic change.

1. Inspect existing series, state, runtime, tests, exports, manifest, and docs.
2. Verify the TradingView Pine v6 Reference Manual signature and semantics.
3. Define warm-up, `na`, qualifier, return-shape, history, and realtime requirements before coding.
4. Write failing deterministic tests first.
5. Implement the smallest correct algorithm with pure numerical kernels where practical.
6. Keep incremental state explicitly scoped to a runtime/execution context.
7. Test insufficient history, edge lengths, `na`, history offsets, numerical fixtures, realtime updates, and independent runtime isolation.
8. Differential-test against Pine reference outputs when available.
9. Update the TA manifest, generated inventory, exports, and coverage docs.
10. Run targeted tests followed by `pnpm check` and `pnpm build` when applicable.

Use Strategy, Memento, Adapter, Facade, Factory, and Observer only when they solve an actual architecture problem. Never force patterns into simple formulas. Never use global mutable indicator state, hidden lookahead, invented missing values, `as any`, or disabled type/lint rules.
