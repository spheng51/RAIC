# Full Project Review - Open-RAIC (RAIC)

Date: 2026-04-12
Reviewer: Codex agent
Scope: Historical baseline review of `main` (`6ef775f`), remediation on the current working tree of `codex/platform-ops-readiness-retention`, and merge-readiness verification of `codex/governed-ai-staging-candidate` after integrating current `main`.

## Executive Summary

- The original review findings have been resolved in the reviewed branch worktrees.
- The current working tree on `codex/platform-ops-readiness-retention` is green for `pnpm check`, `pnpm lint` (warnings only), `pnpm exec tsc --noEmit`, `pnpm test`, and `pnpm exec playwright test e2e/tests/auth-classroom-flows.spec.ts`.
- `codex/governed-ai-staging-candidate` is no longer a stale, conflicted snapshot. It was merged with current `main`, recorded as `e3db69d`, and passes the full gate set in that merged state.
- The baseline `main` commit `6ef775f` remains the historical source of the original findings. This pass fixed those issues on descendant review branches rather than rewriting `main` directly.

## Branch Topology

- `main`: `6ef775f` (`Merge pull request #1 from spheng51/codex/hardening-review-fixes`)
- `codex/platform-ops-readiness-retention`: `0f7a45d` at branch head, plus the local remediation changes in the current working tree
- `codex/governed-ai-staging-candidate`: original reviewed snapshot `24605ab`
- Verified governed merge result: `e3db69d` (`Merge branch 'main' into codex/governed-ai-staging-candidate`)

## Resolved Findings

### 1. Deterministic DB retry coverage

Files:
- `tests/server/db-client.test.ts`

Resolution:
- Removed the ambient localhost Postgres dependency from the retry-path test.
- Added a deterministic test seam using `globalThis.__raicPlatformSqlClient`.
- Isolated filesystem state per test under `.vitest-tmp/...` so the JSON fallback path no longer shares mutable state with unrelated tests.

Result:
- `pnpm test` is green on the remediated current branch.

### 2. Missing direct Postgres-path retention coverage

Files:
- `tests/server/platform-retention.test.ts`

Resolution:
- Added explicit Postgres-path mocking through seeded global schema/client state.
- Added coverage for candidate collection and deletion inside the transaction-backed retention path.
- Isolated retention test filesystem state under `.vitest-tmp/...`.

Result:
- The retention branch no longer has the original Postgres test-gap finding.

### 3. Cross-file classroom storage test race

Files:
- `tests/server/classroom-storage.test.ts`
- `tests/server/classroom-media-route.test.ts`
- `tests/server/mirofish.test.ts`

Resolution:
- Removed the shared reliance on `process.cwd()/data/classrooms` across concurrent Vitest files.
- Switched the affected suites to per-test temporary roots by mocking `process.cwd()` into isolated `.vitest-tmp/...` directories.

Result:
- The MiroFish/shared-simulation regression no longer reproduces in the full unit suite.

### 4. Governed branch merge risk and stale verification state

Files touched during merge resolution:
- `lib/server/api-response.ts`
- `lib/server/classroom-storage.ts`

Additional validation support:
- `tests/server/db-client.test.ts`
- `tests/server/classroom-storage.test.ts`
- `tests/server/classroom-media-route.test.ts`
- `tests/server/mirofish.test.ts`

Resolution:
- Merged current `main` into `codex/governed-ai-staging-candidate`.
- Resolved the previously blocking conflicts in the auth cookie/session response path and classroom storage/shared-simulation preservation path.
- Refreshed the worktree install with `pnpm install --frozen-lockfile`, which restored `jsdom` and allowed the component test workers to start.
- Recorded the verified merge as commit `e3db69d`.

Result:
- The governed branch is now reviewable as a current merge candidate instead of a stale divergent snapshot.

## Remaining Non-Blockers

- `pnpm lint` still reports 26 warnings on both verified branches.
- No lint errors, type errors, unit test failures, or e2e failures remain in the verified remediation states.

## Automated Check Matrix

### Historical baseline reference: `main` (`6ef775f`)

- Original findings source only; this pass did not rewrite `main` directly.
- The failures previously observed against that baseline are resolved in the branch worktrees described below.

### Current working tree: `codex/platform-ops-readiness-retention`

- `pnpm check`: passed
- `pnpm lint`: passed with 26 warnings
- `pnpm exec tsc --noEmit`: passed
- `pnpm test`: passed (`49/49` files, `262/262` tests)
- `pnpm exec playwright test e2e/tests/auth-classroom-flows.spec.ts`: passed (`3/3` tests)

### Verified merge result: `codex/governed-ai-staging-candidate` (`e3db69d`)

- `pnpm install --frozen-lockfile`: passed
- `pnpm check`: passed
- `pnpm lint`: passed with 26 warnings
- `pnpm exec tsc --noEmit`: passed
- `pnpm test`: passed (`47/47` files, `256/256` tests)
- `pnpm test:e2e`: passed (`9/9` tests)

## Branch Verdicts

### `codex/platform-ops-readiness-retention`

- Acceptable.
- The reviewed findings against this line are resolved in the current working tree.
- Remaining work is limited to optional cleanup of existing lint warnings and landing the branch changes.

### `codex/governed-ai-staging-candidate`

- Acceptable in the merged state recorded at `e3db69d`.
- The original merge-readiness blocker is resolved.
- The branch now has a validated path to land against current `main`.

## Recommended Next Actions

1. Commit and land the remediation changes from `codex/platform-ops-readiness-retention` so the deterministic test fixes and retention coverage move forward into `main`.
2. Push the governed branch merge commit `e3db69d` if that branch is still intended to land.
3. Triage the remaining 26 lint warnings as a separate quality pass; they no longer block merge readiness.
