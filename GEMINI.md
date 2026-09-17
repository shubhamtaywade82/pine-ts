# Pine-TS Gemini / Antigravity Guidance

`AGENTS.md` is the canonical repository contract. Follow it before making any change.

## Agent behavior

- Treat Pine Script v6 behavior as a compatibility target, not an inspiration.
- Inspect existing code and tests before creating abstractions.
- Use test-first development for every semantic change.
- Preserve strict TypeScript and modern ESM syntax.
- Prefer composition, dependency injection, pure mathematical kernels, and explicit state ownership.
- Use Strategy, Adapter, Memento, Facade, Factory, and Observer patterns only where they reduce coupling or express real runtime semantics.
- Never introduce global mutable indicator state.
- Never introduce lookahead or silently coerce missing values.
- Never weaken lint/type checking to make a change pass.
- For TA functions, test warm-up, `na`, history indexing, realtime rollback, numerical accuracy, and independent runtime isolation.
- Keep public API changes deliberate and update exports, manifest, generated inventory, tests, and documentation together.
- Run targeted checks first, then the full repository quality gate when practical.

## Safe autonomous loop

1. Inspect.
2. Identify the smallest coherent change.
3. Verify Pine v6 reference semantics.
4. Add failing tests.
5. Implement.
6. Run targeted checks.
7. Refactor for clarity without changing behavior.
8. Run `pnpm check` and `pnpm build` when applicable.
9. Report exact validation results.
