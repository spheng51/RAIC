# Future Roadmap: Reliable Adaptive Learning Platform

This roadmap translates the current single-branch model into a dated execution sequence with one validated slice landing at a time.

The active cycle plan for this window is documented in [Execution Plan: v0.4.0 Reliable Adaptive Learning Platform (2026-05-17)](./execution-plans/2026-05-17-v0.4.0-reliable-adaptive-learning-platform.md).

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

- Completed milestone: Adaptive Classroom Intelligence v1 (`v0.3.0`)
  - Result: teacher-only repeated-session adaptation is live on `main` with unchanged public/student flows and production smoke evidence.

- Prep patch: Release Hygiene
  - Goal: align public docs with `v0.3.0`, Node 24, and the current `v0.4.0` plan.
  - Acceptance: no runtime code changes, clean branch, docs links resolve, and release verification remains green.

- Milestone A: Provider Composer completion
  - Goal: bring scenario-managed provider routing to scene outline, scene content, and scene action generation.
  - Acceptance: public request/response payloads stay stable, scenario telemetry is emitted, and managed routes validate capability before provider use.

- Milestone B: Fail-closed provider hardening
  - Goal: remove unmanaged fallback from strict scenario-managed paths.
  - Acceptance: invalid managed candidates return governed 4xx responses, and tests prove no unmanaged fallback call is made.

- Milestone C: Learning Analytics + Reflection
  - Goal: turn teacher-only session context and reflection records into private aggregate quality signals.
  - Acceptance: anonymous, public, and student analytics remain off by default; retention policy covers reflection-derived artifacts.

- Milestone D: Adaptive Student Beta
  - Goal: introduce opt-in student-facing adaptation only after explicit privacy, consent, retention, and public API review.
  - Acceptance: behavior is feature-flagged, reversible, and covered by non-leakage tests.

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
- Reflection and session-context behavior remain teacher-only until the analytics or student beta milestones explicitly expand scope.
