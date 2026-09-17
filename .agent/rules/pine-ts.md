# Pine-TS Agent Rules

- `AGENTS.md` is the canonical engineering contract; follow it first.
- Pine Script v6 behavior is the specification. Verify signatures, qualifiers, warm-up, `na`, history, and realtime semantics before implementing TA.
- Use test-first development. Do not write production behavior without a failing test for the new semantic requirement.
- Never introduce lookahead, hidden future-bar reads, or implicit missing-value coercion.
- Runtime state and indicator state must be isolated. Do not add global mutable Maps/Sets that retain execution state.
- Preserve strict TypeScript, modern ESM, arrow functions where syntactically appropriate, `readonly`, `unknown`, discriminated unions, and `import type`.
- Avoid `any`, unjustified assertions, `@ts-ignore`, non-null assertions, and disabled lint/type rules.
- Use Strategy, Memento, Adapter, Facade, Factory, and Observer only when they solve a concrete problem. Do not patternize simple arithmetic.
- TA implementations must cover numerical fixtures, warm-up/`na`, history offsets, realtime updates/close, and independent runtime isolation where applicable.
- Update tests, exports, manifest/inventory, and docs with public API changes.
- Run targeted checks first, then `pnpm check` and `pnpm build` when applicable.
- Never claim validation passed unless it actually ran and passed.
