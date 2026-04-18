# Future Roadmap: Release Recovery + Originality + Reliability

This roadmap translates the current single-branch model into a dated execution sequence with one validated slice landing at a time.

The active cycle plan for this window is documented in [Execution Plan: Release Recovery + Next Two Milestones (2026-04-17)](./execution-plans/2026-04-17-release-recovery-and-next-milestones.md).

## 1) Operating baseline

- Keep `main` as the only shared branch.
- Keep development in short-lived local scratch branches (`codex/*`).
- For every slice:
  - run slice-targeted checks first,
  - merge into local `main`,
  - run the required gate sequence on `main`,
  - attach benchmark evidence when the slice touches latency-sensitive classroom paths.
- Keep PRs and merge slices one-purpose only. Do not merge multi-objective behavior stacks.

## 2) Active milestone sequence

- Milestone 0: Release Recovery and Slice Decomposition
  - Goal: decompose parked intelligence/provider work into promotable slices and clear the current MiroFish and benchmark-evidence blockers.
  - Focus: reviewed correctness fixes, MiroFish reclaim-control E2E recovery, live benchmark snapshot capture, and clean merge-lane hygiene.

- Milestone 1: Adaptive Classroom Intelligence v1
  - Goal: activate teacher-only repeated-session intelligence using session-context and reflection as the source of truth.
  - Acceptance: deterministic adaptation replay coverage, unchanged public/student flows, and no regression against classroom runtime budgets.

- Milestone 2: Experimentation & Provider Composer v1
  - Goal: complete provider-scenario routing with explicit capability validation, fallback telemetry, and rollback-ready internal routing coverage.
  - Acceptance: fail-closed behavior, unchanged public provider contracts, and benchmark-backed routing stability.

- Queued next milestone: Learning Analytics + Reflection activation
  - Goal: turn the already-landed teacher-only reflection foundation into internal experimentation signals after Provider Composer stabilizes.

## 3) Performance and ops overlap

- Keep benchmark artifact capture and `ops:verify` evidence enforcement active throughout every milestone.
- Track deltas in `data/perf-results/latest.json` and surface the latest benchmark artifact in internal admin ops views.
- Optimize deterministic and low-noise execution as milestones advance:
  - provider capability metadata reuse,
  - repeated classroom state reuse where safe,
  - controlled e2e fixture setup and teardown.

## 4) Reliability hardening

- `ops:drift` and branch hygiene remain mandatory at handoff.
- Keep performance trend visibility in CI as non-blocking reporting unless explicitly promoted to a required gate.
- Maintain rollback preconditions, benchmark evidence links, and single-purpose slice boundaries for every merge.
- Keep follow-up decomposition streams and future reliability work serialized through the same merge model.

## 5) Exit criteria for each slice

- Functional gates: the full release gate set on local `main`, including `pnpm run ops:verify`.
- Perf gates: a valid non-fixture benchmark artifact when the slice touches latency-sensitive classroom or provider paths.
- Merge hygiene: no stale local branches, worktrees, or parked multi-objective residue after handoff.

## 6) Governance contract

- No public API changes unless explicitly scoped and reviewed as such.
- No mixed "cleanup + feature + reliability" slices.
- Each slice must define rollback conditions before merge.
- Reflection and session-context behavior remain teacher-only until the later analytics milestone explicitly expands scope.
