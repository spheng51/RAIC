# Future Roadmap: Originality + Performance + Reliability

This roadmap converts the current single-branch model into a repeatable innovation engine.

## 1) Operating baseline (immediate)

- Keep `main` as the only shared branch.
- Keep development in short-lived local scratch branches (`codex/*`).
- For every slice:
  - run slice-targeted checks,
  - run `pnpm run ops:verify`,
  - run deterministic benchmark checks when the slice touches classroom runtime paths and a harness exists.
- Keep PRs one-purpose only and avoid multi-objective behavior merges.

## 2) Originality execution (2-6 weeks cadence)

Run one bounded slice at a time.

- Adaptive Classroom Intelligence
  - Goal: contextual classroom behavior using deterministic prior-session context.
  - Acceptance:
    - quality score improves on fixed internal corpus,
    - no increase in end-to-end p95 latency for baseline classroom paths.
  - Required artifacts: feature brief plus before/after corpus summary.

- Experimentation & Provider Composer
  - Goal: deterministic provider routing scenarios for generation workflows.
  - Acceptance:
    - provider capability validation is explicit and fails closed,
    - rollback condition documented per experiment set.

- Learning Analytics + Reflection
  - Goal: in-session reflection and quality signal capture with no new public payload contracts.
  - Acceptance:
    - deterministic telemetry fixture,
    - quality-loop signals are available for experimentation.

## 3) Performance track (4-8 weeks overlap with originality)

- Add and enforce budget-aware baselines once the benchmark harness lands.
- Optimize deterministic and low-noise execution:
  - cache/reuse provider capability metadata,
  - request coalescing for repeated classroom state fetches,
  - controlled e2e fixture setup and teardown.
- Track deltas in `ops/perf-results/latest.json` and attach to PRs when latency-critical paths are touched.

## 4) Reliability hardening (ongoing)

- `ops:drift` and branch hygiene are mandatory at handoff.
- Keep performance trend job in CI as non-blocking visibility.
- Maintain PR checklist items for benchmark artifacts and rollback preconditions.
- Keep PR #13 decomposition streams single-threaded:
  - access-code hardening,
  - custom-provider credential enforcement,
  - happy-path deterministic e2e.

## 5) Exit criteria for each slice

- Functional gates: `pnpm run ops:verify`
- Perf gates: run the relevant deterministic benchmark harness for the touched path once it exists.
- No regressions in core `main` behavior and no stale branch/worktree residue.

## 6) Governance contract

- No public API changes unless explicitly scoped as breaking.
- No mixed "cleanup + feature + reliability" changes in one slice.
- Each slice must include deterministic rollback conditions before merge.
