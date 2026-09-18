# Pine-TS AI Coding Rules

## Mission

`pine-ts` is a Pine Script v6-compatible analytical runtime for TypeScript trading systems. Correctness against Pine semantics is more important than API convenience, cleverness, or implementation speed.

## Non-negotiable rules

1. Pine semantics are the specification. Verify Pine v6 signatures, qualifiers, warm-up behavior, `na`, history, and realtime behavior.
2. Tests before implementation. Add a failing test first, then the minimum production code needed to pass it.
3. Never introduce lookahead. Historical code must not read future bars.
4. Never invent missing values. Do not turn `na` into zero or another value unless Pine does so.
5. State is runtime-scoped. Persistent state, indicator state, rollback snapshots, and caches must not leak across independent runtimes.
6. Avoid global mutable trading or indicator state.
7. Determinism is required for identical inputs and execution conditions.
8. Numerical correctness comes before optimization. Benchmark before optimizing.
9. Public API changes require tests, docs, exports, manifest/inventory updates, and compatibility notes.
10. Third-party TA packages are not Pine compatibility oracles.

## Clean TypeScript

Follow the principles in `labs42io/clean-code-typescript`.

- Use precise, intention-revealing names.
- Prefer small functions with one responsibility.
- Prefer pure functions for mathematical transformations.
- Keep side effects at boundaries.
- Prefer composition and dependency injection over inheritance and concrete dependencies.
- Use `import type` for type-only imports.
- Prefer `readonly` for immutable contracts.
- Avoid `any`; use `unknown` and explicit narrowing.
- Avoid unnecessary type assertions and non-null assertions.
- Use discriminated unions for stateful variants.
- Give public APIs explicit return types.
- Never swallow errors or rejected promises.
- Do not leave commented-out code or journal comments.
- Comments should explain why or Pine-specific semantics, not obvious code.
- Prefer guard clauses over deep nesting.

## Modern TypeScript

- Use the newest syntax supported by the repository compiler.
- Prefer `const`, arrow functions, `satisfies`, discriminated unions, optional chaining, nullish coalescing, and `import type`.
- Prefer standard modern APIs such as `find`, `includes`, `Object.fromEntries`, and `Number.isFinite` when clearer.
- Keep ESM imports with explicit `.js` extensions.
- Do not weaken strict compiler settings to make code compile.

## Design patterns: intentional use only

Patterns already appropriate to this architecture:

- Strategy: `PineScript` is the executable strategy supplied to `PineRuntime`.
- Memento: `PineState.snapshot()` / `restore()` model realtime rollback.
- Adapter: `MarketDataProvider` isolates exchanges/data providers from the runtime.
- Facade: `PineRuntime` is the high-level execution facade; `PineContext` is the Pine-facing execution surface.
- Value Object/Composite: OHLC-derived series are composed from primitive bar series.
- Factory: use when constructing interchangeable runtime/provider/cache implementations.
- Observer: appropriate for optional runtime telemetry/events; never make event delivery part of mathematical indicator semantics.

Do not force GoF patterns into small mathematical functions. A pattern is justified only when it reduces coupling, isolates change, or makes Pine semantics explicit.

## TA implementation contract

Every TA function must test/document: Pine v6 signature and qualifiers; return shape; warm-up period; `na` behavior; history indexing; realtime rollback; floating-point tolerance; incremental/recompute strategy; complexity and memory characteristics.

## Indicator state

Incremental state must be explicit and scoped to an execution/runtime context. Prefer targeted invalidation over global invalidation. Never retain runtime or series objects in module-level collections.

## Testing requirements

For every new feature, include applicable golden numerical fixtures, warm-up/`na` cases, history indexing, edge cases, realtime tick/update/close behavior, independent-runtime isolation, regressions, and useful properties/invariants. Tests must be deterministic, independent, and network-free.

## Pine compatibility workflow

1. Check the official TradingView v6 Reference Manual.
2. Create a minimal Pine reference fixture when practical.
3. Capture representative reference outputs.
4. Implement the smallest correct TypeScript behavior.
5. Differential-test `pine-ts` against the reference.
6. Add the case to the compatibility suite.
7. Update `api-manifest/ta.v6.json` and generated inventory.
8. Update `docs/TA-COVERAGE.md`.

## AI agent workflow

Before editing, inspect relevant source, tests, exports, manifest, and docs; search for existing abstractions; and avoid overwriting unrelated changes.

After editing, run targeted tests, formatting/lint/type checks, and the full quality gate when practical. Run `pnpm build` for public API changes. Never claim a check passed unless it actually ran and passed.

## Quality gate

```text
pnpm build
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm spellcheck
pnpm knip
pnpm package:lint
pnpm types:check
```

`pnpm check` is the combined quality gate. It runs `pnpm build` first because the package validations (`package:lint`, `types:check`) inspect the built `dist` artifacts.

## Forbidden shortcuts

- Do not disable lint/type rules to hide defects.
- Do not add unjustified `@ts-ignore`.
- Do not use `as any` to bypass typing.
- Do not call third-party TA output Pine reference behavior.
- Do not add speculative abstractions.
- Do not optimize before measuring.
- Do not silently change Pine semantics for TypeScript convenience.
