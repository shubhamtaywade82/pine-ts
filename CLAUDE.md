# Claude Code Project Guidance

Read `AGENTS.md` first. It is the canonical engineering contract for this repository.

## Claude-specific operating rules

- Work in small, reviewable increments.
- Before editing a subsystem, inspect its tests, public exports, and nearby abstractions.
- Prefer modifying an existing abstraction over introducing a parallel abstraction.
- For Pine TA work, verify TradingView v6 semantics before coding and create the numerical test fixture first.
- Preserve Pine rollback/commit semantics. Never simplify realtime behavior merely to make an indicator easier to implement.
- Do not use the LLM to guess indicator formulas, warm-up rules, or `na` semantics when a reference can be checked.
- Keep mathematical kernels deterministic and side-effect free where possible.
- Use design patterns only when they solve a concrete coupling/state/construction problem.
- Do not refactor unrelated code while implementing an indicator.
- After changes, run the smallest relevant tests first and then `pnpm check` when practical.
- Never claim tests, builds, or CI passed without actually running or observing them.

## Suggested implementation loop

`inspect -> verify Pine semantics -> write failing test -> implement -> targeted test -> refactor -> quality gate -> update docs/manifest`
