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
