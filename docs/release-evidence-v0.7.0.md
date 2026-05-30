# Release Evidence: v0.7.0 Discord Scheduled-Class Beta Readiness

Date: 2026-05-30
Target release: `v0.7.0`
Evidence status: draft branch evidence. Final clean-main gates, live Discord smoke, production deployment ID, and tag are pending.

## Scope

`v0.7.0` ships Discord scheduled-class support as a production beta for signed-in teachers.

- Backend foundation: Discord OAuth/API routes, connection storage, scheduled-event sync, reminder cron, delete cleanup, and access tests.
- Teacher UI follow-up: Studio schedule-box Discord setup row, channel save/disconnect, per-class sync controls, warning/status display, and teacher-server-only visibility.
- Release gate: `pnpm run smoke:discord-beta` for automated API guard checks, optional credentialed sync/cron checks, and manual Discord beta smoke checklist.
- Out of scope: duplicate `* 2.*` cleanup and the older dirty `/repo` worktree.

## Pull Requests

- Backend PR: `#53`, merged into `main` as `de2fdf20a99388748e60804a50a586900375706a`.
- Teacher UI PR: `#54`, branch `codex/v0.7.0-discord-scheduled-classes-ui`.
- Notable branch commits:
  - `303e30d` `feat: add discord schedule teacher UI`
  - `aade99c` `test: add discord beta smoke gate`
  - `d43bf01` / `42734e3` evidence and release-readiness doc hardening.
  - `48db290` scheduled-class route regression tests.
  - `a706168` / `f49bebc` CI E2E timeout and system-Chrome hardening.
  - `d651003` release evidence for the green `f49bebc` PR checks.
  - `42cba11` first fully checked implementation head after protected-preview smoke blocker/bypass handling, GitHub Actions Node 24-native action upgrades, and the `ops:drift` workflow action runtime guard.
  - `786e241` one-time Discord OAuth state-cookie cleanup on every callback redirect path.
  - `639a6fb` recoverable `UPSTREAM_ERROR` response when Discord channel loading fails while saving the announcement channel.
  - `bd2b20c` latest fully checked head before this final evidence refresh; GitHub CI and Vercel preview checks were green.
  - Current ops slice: feature-aware Vercel env audit for required Discord beta keys.

## Branch Evidence

Environment:

- Workspace: `/Users/matthewgore/Desktop/CODEX/Open-RAIC/repo-main`
- Branch: `codex/v0.7.0-discord-scheduled-classes-ui`
- Base: `main` at `de2fdf20a99388748e60804a50a586900375706a`
- Local Node available during this evidence update: `v22.11.0` with expected `engines.node=24.x` warning.

Passed focused gates:

- `corepack pnpm test tests/server/discord-integration-routes.test.ts`
  - Result: 18 tests passed, including OAuth callback state-cookie cleanup and recoverable channel-save error coverage.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/discord-integration-routes.test.ts`
  - Result: 18 tests passed.
- `corepack pnpm test tests/server/discord-beta-smoke-script.test.ts`
  - Result: 7 tests passed after protected-preview blocker and bypass coverage was added.
- `corepack pnpm test tests/server/ops-check-workflow-policy.test.ts`
  - Result: 3 tests passed.
- `corepack pnpm test tests/server/vercel-env-audit.test.ts`
  - Result: 7 tests passed.
- `corepack pnpm test tests/server/scheduled-classes.test.ts tests/server/discord-integration-routes.test.ts tests/server/discord-beta-smoke-script.test.ts`
  - Result: 3 files passed, 28 tests passed before the later bypass-token smoke-script case was added; the focused smoke-script rerun above is the current count.
- `corepack pnpm test tests/server/discord-integration-routes.test.ts tests/server/scheduled-classes-route.test.ts tests/server/scheduled-classes.test.ts tests/lib/discord-scheduled-classes.test.ts tests/components/schedule-classes-box.test.tsx tests/server/discord-beta-smoke-script.test.ts`
  - Result: 6 files passed, 52 tests passed.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/discord-integration-routes.test.ts tests/server/scheduled-classes-route.test.ts tests/server/scheduled-classes.test.ts tests/lib/discord-scheduled-classes.test.ts tests/components/schedule-classes-box.test.tsx tests/server/discord-beta-smoke-script.test.ts`
  - Result: 6 files passed, 52 tests passed.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/ops-check-workflow-policy.test.ts`
  - Result: 3 tests passed.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/vercel-env-audit.test.ts`
  - Result: 7 tests passed.
- `npx -y node@24 ./node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false --diagnostics`
  - Result: completed in 55.38s.
- `node ./node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false --diagnostics`
  - Result after CI system-Chrome config update: completed in 13.29s.
- `PLAYWRIGHT_USE_SYSTEM_CHROME=true corepack pnpm exec playwright test --list`
  - Result: Playwright loaded config and listed 33 tests in 10 files.
- `node --check scripts/discord-beta-smoke.mjs`
- `node --check scripts/vercel-env-audit.mjs`
- `node --check scripts/lib/vercel-env-audit.mjs`
- `VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord node scripts/vercel-env-audit.mjs`
  - Result: exited 2 as expected without Vercel credentials and printed the manual fallback, including the Discord feature-required key list, without secret values.
- `node scripts/discord-beta-smoke.mjs --help`
- `corepack pnpm exec prettier package.json scripts/discord-beta-smoke.mjs tests/server/discord-beta-smoke-script.test.ts tests/support/discord-beta-smoke-fetch-mock.mjs --check`
- `corepack pnpm exec prettier lib/server/scheduled-classes.ts tests/server/scheduled-classes.test.ts tests/server/discord-integration-routes.test.ts scripts/discord-beta-smoke.mjs tests/server/discord-beta-smoke-script.test.ts tests/support/discord-beta-smoke-fetch-mock.mjs --check`
- `corepack pnpm run check:i18n-keys`
  - Result: i18n key alignment passed.
- `corepack pnpm exec prettier .github/workflows/ci.yml --check`
- `RAIC_DISCORD_SMOKE_BASE_URL=https://raic-git-codex-v070-discor-908f39-vangorestudios-6959s-projects.vercel.app corepack pnpm run smoke:discord-beta -- --allow-blockers`
  - Result: exited 0 with zero automated failures and one blocker: Vercel deployment protection. Live app API smoke still requires preview auth/bypass plus Discord beta credentials.
- Protected-preview bypass path is now supported with `RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN`; the token is operator-local and must not be stored in project env or release evidence.
- `ops:env:vercel` now supports `VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord` so preview and production env audits can require `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET` without exposing values.
- CI now uses `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, and `actions/upload-artifact@v6`, whose action metadata targets Node 24 without the temporary force-runtime override.
- `ops:drift` enforces those Node 24-native CI action major floors so the release gate catches accidental downgrades.
- `git diff --check`
  - Result: no whitespace errors.

Current-slice typecheck note:

- `corepack pnpm exec tsc --noEmit` and `npx -y node@24 /usr/local/bin/corepack pnpm exec tsc --noEmit` both started but remained silent in this local desktop sandbox and were stopped. The direct TypeScript binary completed successfully under Node 24. Re-run the canonical `corepack pnpm exec tsc --noEmit` on CI or clean local `main` before marking `v0.7.0` ready.

Current-slice CI note:

- PR `#54` CI on `bd2b20c` was draft, mergeable, and green for Ops Drift, MiroFish Contract Gate, Lint/Typecheck/Unit Tests, E2E Tests, Vercel preview, and Vercel preview comments. Vercel Agent Review completed as neutral/non-blocking.
- The CI E2E job now skips Playwright browser installation, verifies system Chrome, and runs Playwright with `PLAYWRIGHT_USE_SYSTEM_CHROME=true`, retaining a 45-minute job timeout and 30-minute test timeout.
- The latest green E2E run completed successfully at `2026-05-30T17:21:28Z`. Vercel reported preview deployment `3ydpjm3r1etSCJQd1ba6k5Qc6xsG` ready at `2026-05-30T17:19:23Z`.

Earlier full branch gates on `303e30d` passed before the smoke hardening slice:

- Focused Discord/schedule/component tests.
- `corepack pnpm run check:i18n-keys`
- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm run check`
- `corepack pnpm lint`
- `corepack pnpm test`
- `corepack pnpm run build`
- `CI=1 corepack pnpm run test:e2e`
  - Result: 32 Playwright tests passed, 1 skipped.

## Coverage Notes

- `tests/server/discord-integration-routes.test.ts` covers connection snapshot/configured state, channel update/delete, recoverable channel-save failures when Discord channel listing fails, OAuth start, OAuth callback success and negative paths, one-time OAuth state-cookie cleanup on callback redirects, cron authorization, Discord sync success, sync not-found, sync validation errors, and teacher-only access.
- `tests/server/scheduled-classes-route.test.ts` covers scheduled-class list/create/update/delete paths, classroom access checks, multiplayer game-mode validation, `PATCH` missing-id and duration validation mapping, `DELETE` body/query id handling, and teacher-only access.
- `tests/server/scheduled-classes.test.ts` covers Discord scheduled-event cleanup on class deletion, already-missing Discord events, hard delete failures preserving the RAIC class, and legacy synced records not silently moving to another Discord connection.
- `tests/server/discord-beta-smoke-script.test.ts` covers CLI help, invalid base URL summaries, default blocker exit behavior, `--allow-blockers`, Vercel deployment-protection blocker detection, Vercel bypass-token injection, and smoke-specific cron secret precedence.
- `tests/server/ops-check-workflow-policy.test.ts` covers the `ops:drift` guard for Node 24-native GitHub Actions majors in the CI workflow.
- `tests/server/vercel-env-audit.test.ts` covers feature-required Discord env keys, unknown feature names failing closed, manual fallback feature-key output, and non-leakage of secret values in audit results.
- `tests/components/schedule-classes-box.test.tsx` covers hidden Discord UI without the teacher prop, not-configured state, channel save/disconnect, sync callbacks, warning/link rendering, and no-classroom disabled state.

## Pending Release Gates

Run from a clean updated `main` after PR `#54` merges:

- `corepack pnpm run secrets:scan`
- `corepack pnpm run ops:drift`
- `corepack pnpm run check:i18n-keys`
- `corepack pnpm exec tsc --noEmit`
- `corepack pnpm run check`
- `corepack pnpm lint`
- `corepack pnpm test`
- `corepack pnpm run build`
- `CI=1 corepack pnpm run test:e2e`
- `corepack pnpm run ops:verify`
- `VERCEL_ENV_AUDIT_CONTEXTS=preview VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord corepack pnpm run ops:env:vercel`
- `VERCEL_ENV_AUDIT_CONTEXTS=production VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord corepack pnpm run ops:env:vercel`

## Discord Smoke Plan

Preview first:

- Configure Discord app callback URL for the preview deployment at `/api/integrations/discord/oauth/callback`.
- Configure Vercel preview env: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET`.
- Verify preview env presence with `VERCEL_ENV_AUDIT_CONTEXTS=preview VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord corepack pnpm run ops:env:vercel`; record only present/missing status.
- Run `corepack pnpm run smoke:discord-beta -- --allow-blockers` before live prerequisites exist.
- Run `corepack pnpm run smoke:discord-beta` with:
  - `RAIC_DISCORD_SMOKE_BASE_URL`
  - `RAIC_DISCORD_SMOKE_COOKIE`
  - `RAIC_DISCORD_SMOKE_CONNECTION_ID`
  - `RAIC_DISCORD_SMOKE_CHANNEL_ID`
  - `RAIC_DISCORD_SMOKE_EVENT_ID`
  - `RAIC_DISCORD_SMOKE_CRON_SECRET`
  - `RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN` if Vercel deployment protection is enabled on the preview.

Production after preview smoke passes:

- Configure production callback URL: `https://open-raic.com/api/integrations/discord/oauth/callback`.
- Configure the same four Discord/Cron env vars in production.
- Verify production env presence with `VERCEL_ENV_AUDIT_CONTEXTS=production VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord corepack pnpm run ops:env:vercel`; record only present/missing status.
- Run standard production smokes:
  - `corepack pnpm run smoke:production:milestone`
  - `corepack pnpm run smoke:production:classroom`
  - `corepack pnpm run smoke:discord-beta`

Manual Discord beta checks printed by the smoke gate:

- Confirm preview and production callback URLs are registered in the Discord developer app.
- Sign in as a teacher, connect a disposable Discord server, and verify Studio returns with `?discord=connected`.
- Create or choose a future scheduled class with a linked classroom, sync it, and inspect Discord event name/time/location link.
- Edit and re-sync the class, then delete it and confirm the Discord scheduled event is removed or already gone.
- Use a near-term class and cron invocation to confirm the configured channel receives exactly one reminder.

## Current Blockers

- Live preview and production Discord smoke require real `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET` values. Record only variable presence, never secret values.
- Live smoke also requires a maintainer teacher account, a disposable Discord test server, bot install permissions, and a future teacher-owned scheduled class linked to a classroom.
- Final `v0.7.0` closeout requires a clean `main` gate run, production deployment ID, production smoke output, and `v0.7.0` tag.
