# Operations Runbook

## Operating Contract

This repository is kept in a deterministic single-branch state.

- The only shared remote branch is `origin/main` (`origin/HEAD` may still exist as a symbolic ref).
- Local contributors using this repo merge through short-lived validated scratch branches (`codex/*`) and keep `main` as the only active local branch after handoff.
- Every merged slice must pass the same post-merge command contract before `main` is considered promotable.
- PR activity is temporary. Branches representing old merge trains are cleaned up as soon as each stream is stabilized and merged.

## Branch and merge model

This repository uses a single-branch release model.

- `main` is the only meaningful shared branch.
- Feature/decompose work happens in short-lived local scratch branches (typically `codex/*`).
- Scratch branches are merged into local `main` after validation, then discarded.
- Pushes happen from validated local `main` only.
- Remote should contain only `origin/main` (and `origin/HEAD`).

## Post-merge working flow

For each functional slice:

1. Branch from current `main`.
2. Implement one purpose only.
3. Run slice-specific checks first.
4. Merge validated slice into local `main`.
5. Run the required gate set (below) on `main`.
6. Push `main`.
7. Remove the scratch branch locally.

Use `pnpm run ops:verify` for the full required set, or run the same commands manually.

### Parallel prep / single merge lane

- Specialists may prepare disjoint work in parallel, but only one mergeable slice is active at a time.
- One release integrator owns the active merge lane, assembles the slice, runs the final gate set on local `main`, and handles branch cleanup.
- If two contributors or agents need the same write scope, defer the later change to the next slice rather than stacking unrelated work.

## Operational scripts

- `pnpm run ops:drift`: local branch-and-git-state preflight.
- `pnpm run ops:verify`: full gate sequence used for post-merge validation.
- `pnpm run ops:drift -- --strict-remote-backlog`: optional check for stale remote backlog items and merge-train naming.

## Required gate set

Run these gates after each slice merge and before pushing `main`:

- `pnpm run secrets:scan`
- `pnpm run check`
- `pnpm run build`
- `pnpm run test:mirofish:gate`
- `pnpm run test:mirofish:e2e`
- `CI=1 pnpm run test:e2e` (PowerShell: `$env:CI='1'; pnpm run test:e2e`)

### Performance planning

- Performance budget targets are tracked in `ops/perf-budgets.json`.
- Use that budget file to evaluate latency-sensitive classroom/runtime changes when a deterministic benchmark harness exists for the touched path.
- Attach benchmark evidence to release notes or PR notes for critical-path changes rather than relying on ad hoc claims.

### Live benchmark evidence capture

- `pnpm run ops:verify` now requires a real live snapshot at `data/perf-results/latest.json`; the replay fixture is baseline coverage only.
- Capture live evidence through the internal admin ops endpoint, which records through `recordBenchmarkArtifact()` and updates the latest snapshot:
  - `POST /api/admin/ops/benchmarks`
  - auth: `system_admin` web session
  - required body fields: `scope`, `source`, and at least one numeric metric from `ops/perf-budgets.json`
- Do not reuse `ops/benchmark-replay.json` or any payload with `metadata.fixture=true`; fixture-derived evidence is rejected and cannot satisfy the release gate.
- Verify the capture by checking both `/api/admin/ops/benchmarks` and the on-disk `data/perf-results/latest.json` snapshot before running `pnpm run ops:verify`.

## Release security guardrails

- `pnpm run secrets:scan` is mandatory before any production publish and blocks if:
  - a blocked secret-bearing file is tracked (`.env.local`, `server-providers*.yml`);
  - a blocked file exists in tree but is not ignored by git (`.gitignore` guard);
  - a tracked file contains a sensitive assignment (`*_SECRET`, `*_TOKEN`, `*_API_KEY`, etc.);
  - a tracked file leaks obvious secret-like token text.
- `NEXT_PUBLIC_*` variables must never carry secret material. Keep only non-sensitive runtime configuration in `NEXT_PUBLIC_*`.
- Treat `server-providers` overrides as internal: use production environment variables (`RAIC_*`, provider keys, etc.) only.

## Drift prevention after each push

- `git status --short --branch`
- `git branch` (expect only `main`)
- `git branch -r` (expect only `origin/main` and `origin/HEAD`)
- `git worktree list`
- Verify no stale temporary repo directories remain in the parent workspace.
- Confirm no open PRs/issues tied to old merge-train branches are still active.

## Future Execution Tracks

This cycle is split into three tracks for deliberate originality and performance progress:

- Originality track
  - Adaptive Classroom Intelligence
  - Experimentation & Provider Composer
  - Learning Analytics + Reflection
- Performance track
  - Provider metadata cache reuse and deterministic classroom state reuse
  - Collaboration and presentation-state render-path reduction
  - Artifact capture and deterministic e2e fixture hygiene
- Reliability/ops hardening
  - Post-merge cleanup automation and evidence attachment
  - PR template and docs checklists for performance risk and benchmark links
  - Non-blocking CI trend reporting

The active dated execution sequence for the current cycle is documented in:

- `docs/execution-plans/2026-04-17-release-recovery-and-next-milestones.md`

Feature stack details are documented in:

- `docs/feature-briefs/adaptive-classroom-intelligence.md`
- `docs/feature-briefs/experimentation-provider-composer.md`
- `docs/feature-briefs/learning-analytics-reflection.md`
- `docs/future-roadmap.md`

## Verification command order

The canonical local release flow is:

- `pnpm run secrets:scan`
- `pnpm run ops:drift`
- `pnpm run check`
- `pnpm run build`
- `pnpm run test:mirofish:gate`
- `pnpm run test:mirofish:e2e`
- `CI=1 pnpm run test:e2e`

Failure output is intentionally short and gate-oriented; the ops script prints gate labels so CI logs indicate where failure occurred.

## Deferred test coverage debt

The following intentionally skipped tests remain follow-up hardening work:

- `tests/components/use-classroom-collaboration-state.test.ts`
- `tests/components/use-classroom-presentation-state.test.ts`

These duplicate-state emission tests remain skipped until a deterministic hook event-order harness is added for refresh/manual SSE interactions.

## PR #13 Decomposition Streams

## PR #13 follow-up provenance (decomposed)

Deferred PR #13 work is managed as three bounded streams. Re-run each stream as a single-purpose scratch branch and do not merge a second stream until the previous stream is green.

1. ACCESS_CODE + allowlist/verify hardening
   - Provenance: `27e23a6 feat(access-code): rebuild gate on proxy routes`
   - Acceptance criteria:
     - root middleware remains absent for auth/access-code.
     - route allowlist includes `/api/server-providers`, `/api/health`, and token bootstrap endpoints.
     - join/token flows keep existing `/studio` and `/admin` behavior.
   - Owner: security-runtime slice lead.
   - Rollback condition: if token bootstrap or route allowlist failures appear, drop the slice and keep `main` unchanged.

2. Audio custom-provider credential enforcement
   - Provenance: `d6a3ea0 feat(audio): support custom OpenAI-compatible providers`
   - Acceptance criteria:
     - custom OpenAI-compatible TTS/ASR providers are available only with required credentials.
     - no contract changes to existing server-provider API payloads.
     - targeted provider and governed-provider checks pass.
   - Owner: platform-runtime slice lead.
   - Rollback condition: revert this stream if custom provider validation causes regressions in standard provider paths.

3. Happy-path e2e coverage
   - Provenance: `324c735 test(e2e): add end-to-end generation happy path test (#401) (#405)`
   - Acceptance criteria:
     - deterministic rehearsal in standard CI mode.
     - e2e fixture hygiene passes in CI-like runs.
     - no unrelated flow changes bundled with test additions.
   - Owner: quality-assurance slice lead.
   - Rollback condition: revert coverage-only commits if stable e2e signals fail repeatedly outside environment flake.
