# Release Evidence: v0.6.0 Adaptive Student Beta Readiness

Date: 2026-05-19
Target release: `v0.6.0`
Evidence status: final release evidence.

## Scope

`v0.6.0` prepares Adaptive Student Beta without enabling student-facing adaptation by default.

- Adds the `RAIC_STUDENT_ADAPTATION_BETA` operator flag with an unset/false default.
- Keeps teacher adaptive runtime context limited to authenticated teacher web access.
- Requires a future explicit consent path before student adaptive context can load.
- Preserves current public, anonymous, classroom-cookie, and signed-in student behavior.
- Defers Discord scheduled-class integration, duplicate file cleanup, demo video work, and game-arcade sequence work to separate slices.

## Merge And Deployment

- PR: `#52` (`codex/v0.6.0-student-beta-readiness`)
- Merge commit: `5fb9884f6a027c8982e4557833ab2aaffa208b2b`
- Production deployment: `dpl_4kPrTwaBN5W22W7CfxsAhtqQUp9L`
- Production target: `READY`
- Production URL: `https://open-raic.com/`
- Vercel inspector: `https://vercel.com/vangorestudios-6959s-projects/raic/4kPrTwaBN5W22W7CfxsAhtqQUp9L`

## Local Branch Evidence

Environment:

- Branch: `codex/v0.6.0-student-beta-readiness`
- Base: `origin/main` at `990478126d27bb310678a00d6841392f588169e9`
- Commit: `aa140b6cc860fc8b4056288b9cb11a22d0900ce4`
- Node: `v24.15.0` via `npx -y node@24`
- pnpm: `10.28.0`

Passed gates:

- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/adaptive-runtime-prompt.test.ts tests/server/chat-route.test.ts tests/server/pbl-chat-route.test.ts tests/server/generation-routes.test.ts`
  - Result: 4 files passed, 42 tests passed.
- `npx -y node@24 /usr/local/bin/corepack pnpm test`
  - Result: 139 files passed, 1 file skipped; 766 tests passed, 3 tests skipped.
- `npx -y node@24 /usr/local/bin/corepack pnpm exec tsc --noEmit`
- `npx -y node@24 /usr/local/bin/corepack pnpm run check:i18n-keys`
- `npx -y node@24 /usr/local/bin/corepack pnpm run check`
- `npx -y node@24 /usr/local/bin/corepack pnpm lint`
- `npx -y node@24 /usr/local/bin/corepack pnpm run build`
- `npx -y node@24 /usr/local/bin/corepack pnpm run test:mirofish:gate`
  - Result: 20 files passed; 97 tests passed, 2 tests skipped; bundled `tsc --noEmit` completed.
- `npx -y node@24 /usr/local/bin/corepack pnpm run test:mirofish:e2e`
  - Result: 3 Playwright tests passed.
- `CI=1 npx -y node@24 /usr/local/bin/corepack pnpm run test:e2e`
  - Result: 32 Playwright tests passed, 1 skipped.

## Clean-Main Release Gates

Environment:

- Workspace: fresh single-branch `main` clone at `/tmp/openraic-v0.6-main-gate`
- Commit: `5fb9884f6a027c8982e4557833ab2aaffa208b2b`
- Node: `v24.15.0` via `npx -y node@24`
- pnpm: `10.28.0`

Passed gates:

- `npx -y node@24 /usr/local/bin/corepack pnpm run secrets:scan`
- `npx -y node@24 /usr/local/bin/corepack pnpm run ops:drift`
- `npx -y node@24 /usr/local/bin/corepack pnpm run benchmark:milestone`
  - Artifact: `0fd1bed2-7674-4828-ac18-bf256df4acdd`
  - Scope: `multiplayer-game-review`
  - Source: `local-playwright-milestone`
  - Metrics: first meaningful paint `278ms`, classroom start to first scene `593ms`, provider roundtrip p95 `17ms`, classroom reuse reconnect `234ms`.
- `npx -y node@24 /usr/local/bin/corepack pnpm run ops:verify`
  - Result: all verification gates passed.
  - Included drift, secrets, deterministic benchmark replay, live benchmark snapshot, Prettier check, build, MiroFish gate, MiroFish e2e, and full Playwright e2e.

## Production Smoke Evidence

- `npx -y node@24 /usr/local/bin/corepack pnpm run smoke:production:milestone`
  - Base URL: `https://open-raic.com/`
  - Result: 11 passed, 0 failed, 0 blocked, 4 skipped.
  - Required readiness passed for health, server providers, OpenAI LLM readiness, OpenAI model registry, OpenAI image provider readiness, verify-model unconfigured-provider behavior, generate-classroom unauth guard, and missing-classroom 404s.
- `npx -y node@24 /usr/local/bin/corepack pnpm run smoke:production:classroom`
  - Result: 3 automated checks passed, 0 failed.
  - Script listed 5 signed-in classroom manual checks for a disposable classroom, Make shareable, join link, scheduled multiplayer Game class, and asset warning behavior.

## Non-Leakage Coverage

- `tests/server/adaptive-runtime-prompt.test.ts` proves the readiness flag defaults off, flag-only student access is insufficient, rollback to false blocks student adaptive context even with future consent, and authenticated teacher web access still loads context.
- `tests/server/chat-route.test.ts` covers teacher web adaptive context, public-demo chat, classroom-cookie student access, signed-in student web access, and flag-only student access.
- `tests/server/pbl-chat-route.test.ts` verifies PBL routes pass classroom access into the adaptive gate and remain non-adaptive for classroom-cookie access when the beta flag is on.
- `tests/server/generation-routes.test.ts` verifies scene content and scene actions pass request-derived classroom context into the adaptive gate and fail open when no adaptive prompt is available.

## Release Follow-Up

- Keep `RAIC_STUDENT_ADAPTATION_BETA=false` or unset in production until consent, retention, API, and rollout review completes.
- Complete the signed-in classroom manual checklist when a maintainer account is available for full production QA.
- Keep Discord scheduled-class integration and duplicate cleanup out of the `v0.6.0` release line.
