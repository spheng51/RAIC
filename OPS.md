# Operations Runbook

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

## Required gate set

Run these gates after each slice merge and before pushing `main`:

- `npm run check`
- `npm run build`
- `npm run test:mirofish:gate`
- `npm run test:mirofish:e2e`
- `CI=1 npm run test:e2e` (PowerShell: `$env:CI='1'; npm run test:e2e`)

## Drift prevention after each push

- `git status --short --branch`
- `git branch`
- `git branch -r`
- `git worktree list`
- Verify no stale temporary repo directories remain in the parent workspace.
- Confirm no open PRs/issues tied to old merge-train branches are still active.

## PR #13 follow-up provenance (decomposed)

Deferred PR #13 work was decomposed and reintroduced through targeted slices:

1. Access-code middleware/verify flow and request-routing allowlist
   - Completed in `27e23a6 feat(access-code): rebuild gate on proxy routes`
   - Sequencing: first (security and access boundary control)

2. Audio custom-provider compatibility and credential gating
   - Completed in `d6a3ea0 feat(audio): support custom OpenAI-compatible providers`
   - Sequencing: second (provider model updates)

3. Happy-path end-to-end coverage
   - Completed in `324c735 test(e2e): add end-to-end generation happy path test (#401) (#405)`
   - Sequencing: third (validation and confidence gate)

Maintain this order if the work is ever resplit again.
