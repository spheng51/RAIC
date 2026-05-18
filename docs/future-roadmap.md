# Future Roadmap: Reliable Adaptive Learning Platform

This roadmap translates the current single-branch model into a dated execution sequence with one validated slice landing at a time.

The completed v0.4.0 cycle plan is documented in [Execution Plan: v0.4.0 Reliable Adaptive Learning Platform (2026-05-17)](./execution-plans/2026-05-17-v0.4.0-reliable-adaptive-learning-platform.md). The v0.5.0 release evidence is captured in [Release Evidence: v0.5.0 Source-Grounded Experience Presets (2026-05-18)](./release-evidence-v0.5.0.md).

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

- Completed milestone: Reliable Adaptive Learning Platform (`v0.4.0`)
  - Result: Provider Composer scene routing, fail-closed provider hardening, and private teacher/internal learning analytics are live on `main`.
  - Public/student request and response payloads remain stable; Adaptive Student Beta is deferred.

- Completed milestone: Source-Grounded Experience Presets (`v0.5.0`)
  - Result: History Vlog is available as a source-required preset with source-mode metadata, source-backed prompt guardrails, and PDF/web fallback behavior.
  - Release note: no separate `v0.4.0` tag was published before `v0.5.0`; the `v0.5.0` tag/release is the next public release after `v0.3.0` and includes the completed v0.4.0 platform work plus Source-Grounded Experience Presets.

- Next patch: `v0.5.1` Source-Grounded Hardening
  - Goal: monitor History Vlog source failures, web-search fallback behavior, source-mode metadata, and teacher-facing source-required UX.
  - Acceptance: only bug fixes, docs, smoke-test coverage, telemetry clarity, and small source-required UX improvements.

- Next feature milestone: `v0.6.0` Adaptive Student Beta Readiness
  - Goal: write privacy, consent, retention, and public API review before adding student-facing adaptation.
  - Acceptance: behavior is feature-flagged, reversible, and covered by non-leakage tests before release.

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
- Reflection, session-context, and analytics behavior remain teacher/internal until the v0.6.0 student beta milestone explicitly expands scope.
