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
  - `bd2b20c` Discord readiness hardening checkpoint; GitHub CI and Vercel preview checks were green at that point.
  - `fcb110e` feature-aware Vercel env audit for required Discord beta keys, with GitHub CI and Vercel preview checks green.
  - `08ef6a7` PR-local drift evidence gate and Node 24 hosting prerequisite alignment.
  - `5d7048a` TypeScript-safe PR-local drift policy fixture; GitHub CI and Vercel preview checks were green for this code snapshot.
  - `0a36c8c` / `20217e8` recoverable Discord connection warnings, explicit OAuth denial routing, and Studio callback feedback refresh coverage.
  - `f1f55eb` missing-config channel-save protection when Discord config is absent.
  - `d074b03` strengthened teacher-only access coverage for `GET`/`POST`/`DELETE` connection routes.
  - Current hardening slices: recoverable Discord connection snapshot channel-load warnings, explicit OAuth denial routing back to Studio, tested Studio callback feedback/refresh behavior for every Discord callback status, `MISSING_API_KEY` channel-save protection when Discord config is absent, strengthened teacher-only access coverage for `GET`/`POST`/`DELETE` connection routes, organization-scoped Discord connection snapshots/channel saves/disconnects, explicit `not_configured` OAuth callback feedback when Discord config is absent, safe rendering for stored Discord scheduled-event URLs, operator guidance for `?discord=not_configured` pre-credential smoke behavior, automatic recreation of missing upstream Discord scheduled events during re-sync, organization-bound default Discord connection selection during class sync, Discord reminder-state reset when a synced class is rescheduled, in-process request-key locking for JSON classroom generation job create-or-reuse, stale classroom generation request-key retry recovery for file and Postgres stores, stricter smoke proof that automated live sync only passes with a valid Discord scheduled-event URL, malformed reminder-cron count rejection, cron unauth smoke guarding, Vercel bypass-token redaction from smoke redirect diagnostics, scheduled-event URL secret-param redaction in smoke failure output, scheduled-event URL query/hash suppression in the teacher UI and smoke gate, tokenless Vercel CLI fallback for secret-safe env presence auditing, case-insensitive Vercel env-audit context parsing, script-boundary coverage for CLI fallback/source-selection behavior, manual fallback warnings for unknown env-audit feature names, and sanitized CLI failure reporting that does not echo raw stderr.

## Branch Evidence

Environment:

- Workspace: `/Users/matthewgore/Desktop/CODEX/Open-RAIC/repo-main`
- Branch: `codex/v0.7.0-discord-scheduled-classes-ui`
- Base: `main` at `de2fdf20a99388748e60804a50a586900375706a`
- Local Node available during this evidence update: `v22.11.0` with expected `engines.node=24.x` warning.
- Node 24 release-parity checks are listed explicitly with `npx -y node@24 ...`; plain `corepack pnpm ...` entries are local developer-runtime checks and do not replace the final clean-main Node 24 gates.

Passed focused gates:

- `corepack pnpm test tests/server/discord-integration-routes.test.ts`
  - Result: 26 tests passed, including OAuth callback state-cookie cleanup, explicit OAuth denial routing, missing-config OAuth callback feedback, recoverable connection snapshot channel-load warnings, active-organization connection snapshot/channel-save/disconnect scoping, missing-config channel-save protection, recoverable channel-save error coverage, and teacher-only `GET`/`POST`/`DELETE` connection-route access coverage.
- `corepack pnpm test tests/lib/discord-studio-callback.test.ts`
  - Result: 7 tests passed, covering `connected`, `invalid_state`, `missing_guild`, `not_configured`, `error`, unknown statuses, and the connection-snapshot refresh flag used by `/studio`.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/discord-integration-routes.test.ts`
  - Result: 18 tests passed.
- `corepack pnpm test tests/server/discord-beta-smoke-script.test.ts`
  - Result: 14 tests passed after protected-preview blocker/bypass coverage, `?discord=not_configured` checklist guidance, cron unauth smoke guarding, richer response diagnostics, redirect URL bypass-token redaction, scheduled-event URL secret-param redaction in sync failure output, invalid-url regression coverage, Discord-event URL query-param rejection, malformed reminder-cron count coverage, and the stricter valid-Discord-event-URL sync proof were added.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/discord-beta-smoke-script.test.ts`
  - Result before the invalid-url and malformed cron-count regressions were added: 9 tests passed under Node 24. The updated 14-test slice passed locally under the available Node runtime; rerun PR CI after this local hardening is pushed for release-runtime coverage.
- `corepack pnpm test tests/server/scheduled-classes.test.ts`
  - Result: 10 tests passed, including delete cleanup, missing-event delete tolerance, hard delete failure preservation, synced-class reminder-state reset on reschedule, legacy synced-record connection safety, organization-bound default Discord connection selection, cross-organization default-sync rejection, and re-sync recreation when the upstream Discord scheduled event is already gone.
- `corepack pnpm test tests/server/ops-check-workflow-policy.test.ts`
  - Result: 4 tests passed, including the explicit PR-local drift mode guard.
- `corepack pnpm test tests/server/vercel-env-audit.test.ts`
  - Result: 12 tests passed after adding sanitized Vercel CLI JSON parsing, REST/CLI env-record sanitization coverage, script-boundary CLI fallback coverage, PATH preservation coverage, explicit API-source no-fallback coverage, manual fallback warnings for unknown required feature names, script-output secret non-leakage assertions, and CLI failure-stderr redaction coverage.
- `corepack pnpm test tests/server/classroom-generation-job-store.test.ts`
  - Result: 13 tests passed after adding the in-process request-key mutex for the JSON classroom generation job store and stale request-key retry recovery for file scans, claimed jobs, and Postgres active request-key conflicts.
- `corepack pnpm test tests/server/classroom-generation-job-store.test.ts tests/server/discord-beta-smoke-script.test.ts tests/server/vercel-env-audit.test.ts`
  - Result: 3 files passed, 39 tests passed after the stale request-key retry recovery, smoke non-leakage, and env-audit context hardening.
- `corepack pnpm test tests/server/discord-integration-routes.test.ts tests/server/scheduled-classes.test.ts`
  - Result: 2 files passed, 36 tests passed after organization-scoped Discord connection snapshot/save/delete hardening and reminder-state reset on rescheduled synced classes.
- `corepack pnpm test tests/server/discord-integration-routes.test.ts tests/server/scheduled-classes-route.test.ts tests/server/scheduled-classes.test.ts tests/lib/discord-scheduled-classes.test.ts tests/components/schedule-classes-box.test.tsx tests/server/discord-beta-smoke-script.test.ts tests/server/vercel-env-audit.test.ts tests/server/classroom-generation-job-store.test.ts`
  - Result: 8 files passed, 102 tests passed after the latest connection scoping, reminder reset, stale request-key, smoke non-leakage, and env-audit hardening slices.
- `corepack pnpm test tests/server/scheduled-classes.test.ts tests/server/discord-integration-routes.test.ts tests/server/discord-beta-smoke-script.test.ts tests/server/vercel-env-audit.test.ts`
  - Result: 4 files passed, 56 tests passed after the latest org-bound Discord sync, smoke non-leakage, and env-audit hardening.
- `corepack pnpm test tests/server/discord-integration-routes.test.ts tests/server/scheduled-classes-route.test.ts tests/server/scheduled-classes.test.ts tests/lib/discord-scheduled-classes.test.ts tests/components/schedule-classes-box.test.tsx tests/server/discord-beta-smoke-script.test.ts`
  - Result: 6 files passed, 71 tests passed after the latest org-bound Discord sync and non-leakage hardening.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/discord-integration-routes.test.ts tests/server/scheduled-classes-route.test.ts tests/server/scheduled-classes.test.ts tests/lib/discord-scheduled-classes.test.ts tests/components/schedule-classes-box.test.tsx tests/server/discord-beta-smoke-script.test.ts`
  - Result before the latest org-bound Discord sync and non-leakage hardening: 6 files passed, 52 tests passed.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/ops-check-workflow-policy.test.ts`
  - Result: 3 tests passed before the later PR-local drift mode case was added; the updated 4-test slice passed locally under the available Node runtime and then passed PR CI's Node 24 TypeScript/test coverage on `5d7048a`.
- `npx -y node@24 /usr/local/bin/corepack pnpm test tests/server/vercel-env-audit.test.ts`
  - Result: 7 tests passed.
- `npx -y node@24 ./node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false --diagnostics`
  - Result: completed in 55.38s.
- `node ./node_modules/typescript/bin/tsc --noEmit --pretty false --incremental false --diagnostics`
  - Result after CI system-Chrome config update: completed in 13.29s.
- `PLAYWRIGHT_USE_SYSTEM_CHROME=true corepack pnpm exec playwright test --list`
  - Result: Playwright loaded config and listed 33 tests in 10 files.
- `node --check scripts/discord-beta-smoke.mjs`
  - Result: passed after smoke-gate diagnostics and valid-event-URL enforcement.
- `node --check scripts/ops-check.mjs`
- `node --check scripts/vercel-env-audit.mjs`
- `node --check scripts/lib/vercel-env-audit.mjs`
- `corepack pnpm exec prettier scripts/vercel-env-audit.mjs scripts/lib/vercel-env-audit.mjs tests/server/vercel-env-audit.test.ts README-HOSTING.md --check`
  - Result: all matched files use Prettier style after the CLI fallback hardening.
- `VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord node scripts/vercel-env-audit.mjs`
  - Result: exited 2 as expected without Vercel credentials and printed the manual fallback, including the Discord feature-required key list, without secret values.
- `node scripts/discord-beta-smoke.mjs --help`
- `corepack pnpm exec prettier scripts/discord-beta-smoke.mjs tests/server/discord-beta-smoke-script.test.ts tests/support/discord-beta-smoke-fetch-mock.mjs --check`
  - Result: all matched files use Prettier style after the latest smoke-gate hardening.
- `corepack pnpm exec prettier package.json scripts/discord-beta-smoke.mjs tests/server/discord-beta-smoke-script.test.ts tests/support/discord-beta-smoke-fetch-mock.mjs --check`
- `corepack pnpm exec prettier lib/server/scheduled-classes.ts tests/server/scheduled-classes.test.ts tests/server/discord-integration-routes.test.ts scripts/discord-beta-smoke.mjs tests/server/discord-beta-smoke-script.test.ts tests/support/discord-beta-smoke-fetch-mock.mjs --check`
- `corepack pnpm exec prettier scripts/ops-check.mjs tests/server/ops-check-workflow-policy.test.ts package.json README-HOSTING.md --check`
- `corepack pnpm exec prettier scripts/vercel-env-audit.mjs scripts/lib/vercel-env-audit.mjs tests/server/vercel-env-audit.test.ts README-HOSTING.md docs/release-evidence-v0.7.0.md --check`
- `corepack pnpm run check:i18n-keys`
  - Result: i18n key alignment passed.
- `corepack pnpm exec vitest run tests/components/schedule-classes-box.test.tsx --pool=forks --no-file-parallelism --maxWorkers=1 --reporter=verbose`
  - Result: 13 tests passed, including recoverable Discord integration warning display and suppression of unsafe stored Discord event links, including event URLs with sensitive query params.
- `corepack pnpm exec prettier app/api/integrations/discord/oauth/callback/route.ts lib/utils/discord-studio-callback.ts tests/lib/discord-studio-callback.test.ts tests/server/discord-integration-routes.test.ts components/schedule/schedule-classes-box.tsx tests/components/schedule-classes-box.test.tsx --check`
  - Result: all matched files use Prettier style.
- `corepack pnpm exec prettier .github/workflows/ci.yml --check`
- `RAIC_DISCORD_SMOKE_BASE_URL=https://raic-git-codex-v070-discor-908f39-vangorestudios-6959s-projects.vercel.app corepack pnpm run smoke:discord-beta -- --allow-blockers`
  - Result after the `4f8435a` preview deploy: exited 0 with zero automated failures and one blocker: Vercel deployment protection. Live app API smoke still requires preview auth/bypass plus Discord beta credentials.
- Protected-preview bypass path is now supported with `RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN`; the token is operator-local and must not be stored in project env or release evidence.
- `ops:env:vercel` now supports `VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord` so preview and production env audits can require `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET` without exposing values. When `VERCEL_TOKEN` is absent, it can use the logged-in Vercel CLI and sanitizes `vercel env ls --format json` output down to key/target metadata before auditing.
- `VERCEL_ENV_AUDIT_CONTEXTS=preview VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord corepack pnpm run ops:env:vercel`
  - Result on the linked Vercel project: exited 1 from the secret-safe Vercel CLI fallback. Preview currently has `BLOB_READ_WRITE_TOKEN`, but is missing `DATABASE_URL`, `RAIC_SECRET_ENCRYPTION_KEY`, `NEXT_PUBLIC_GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_ID`, an LLM provider key, and all four Discord beta keys: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET`.
- `VERCEL_ENV_AUDIT_CONTEXTS=production VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord corepack pnpm run ops:env:vercel`
  - Result on the linked Vercel project: exited 1 from the secret-safe Vercel CLI fallback. Production base keys and `OPENAI_API_KEY` are present, but all four Discord beta keys are missing: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET`.
- `corepack pnpm run ops:drift:pr`
  - Result: passed on the PR worktree; required a clean working tree, ran CI action runtime policy, and explicitly logged skipped clean-main-only local branch/ref/worktree/scratch-branch hygiene. This is PR evidence only and does not replace final clean-`main` `ops:drift` or `ops:verify`.
- CI now uses `actions/checkout@v6`, `actions/setup-node@v6`, `pnpm/action-setup@v6`, and `actions/upload-artifact@v6`, whose action metadata targets Node 24 without the temporary force-runtime override.
- `ops:drift` enforces those Node 24-native CI action major floors so the release gate catches accidental downgrades.
- `git diff --check`
  - Result: no whitespace errors.

Current-slice typecheck and CI note:

- `corepack pnpm exec tsc --noEmit --pretty false --incremental false --diagnostics` completed locally in 12.06s after the missing-config OAuth callback guard and safe Discord event URL rendering, then in 23.28s after missing upstream Discord event recreation, then in 629.31s after the org-bound Discord sync and non-leakage hardening, then in 1167.41s after stale request-key retry recovery and the latest smoke/env-audit hardening, then in 13.36s after organization-scoped connection handling and reminder-state reset hardening. The latest pushed PR head had passed the canonical Lint, Typecheck & Unit Tests CI job before this local hardening; rerun CI after push and run the canonical clean-main gate after merge before marking `v0.7.0` ready.

Recent completed code CI snapshot:

- PR `#54` CI on `a0f6db48c817ee779ba116b7ce7f5f6a13dcecdd` was draft, mergeable, and green for Ops Drift, MiroFish Contract Gate, Lint/Typecheck/Unit Tests, E2E Tests, Vercel preview, and Vercel preview comments. Vercel Agent Review completed as neutral/non-blocking.
- The CI E2E job now skips Playwright browser installation, verifies system Chrome, and runs Playwright with `PLAYWRIGHT_USE_SYSTEM_CHROME=true`, retaining a 45-minute job timeout and 30-minute test timeout.
- Latest green check times on `a0f6db48c817ee779ba116b7ce7f5f6a13dcecdd`:
  - Ops Drift: `2026-05-31T01:17:33Z`
  - MiroFish Contract Gate: `2026-05-31T01:17:56Z`
  - Lint, Typecheck & Unit Tests: `2026-05-31T01:19:04Z`
  - E2E Tests: `2026-05-31T01:20:11Z`
  - Vercel preview deployment target: `https://vercel.com/vangorestudios-6959s-projects/raic/C9d79r3zfKhwQBUYYXPfXikpWBHD`

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

- `tests/server/discord-integration-routes.test.ts` covers connection snapshot/configured state, active-organization connection snapshot/channel-save/disconnect scoping, teacher-only `GET`/`POST`/`DELETE` connection-route access, recoverable snapshot warnings when Discord channel listing fails, channel update/delete, missing-config channel-save protection, recoverable channel-save failures when Discord channel listing fails, OAuth start, OAuth callback success and negative paths, missing-config OAuth callback feedback without code exchange, explicit OAuth denial routing, one-time OAuth state-cookie cleanup on callback redirects, cron authorization, Discord sync success, sync not-found, sync validation errors, and teacher-only access for protected Discord routes.
- `tests/server/scheduled-classes-route.test.ts` covers scheduled-class list/create/update/delete paths, classroom access checks, multiplayer game-mode validation, `PATCH` missing-id and duration validation mapping, `DELETE` body/query id handling, and teacher-only access.
- `tests/server/scheduled-classes.test.ts` covers Discord scheduled-event cleanup on class deletion, already-missing Discord events, hard delete failures preserving the RAIC class, reminder-state reset when a synced class is rescheduled, legacy synced records not silently moving to another Discord connection, organization-bound default Discord connection selection, cross-organization default-sync rejection, and re-sync recreation when the upstream Discord scheduled event is already gone.
- `tests/server/classroom-generation-job-store.test.ts` covers request-key create-or-reuse serialization, stale request-key jobs being marked failed instead of reused in file scans, stale claimed request-key jobs not blocking retries, and stale Postgres request-key rows being failed before a retry insert.
- `tests/server/discord-beta-smoke-script.test.ts` covers CLI help, invalid base URL summaries, default blocker exit behavior, `--allow-blockers`, `?discord=not_configured` operator guidance, Vercel deployment-protection blocker detection, Vercel bypass-token injection, Vercel bypass-token redaction from redirected response diagnostics, scheduled-event URL secret-param redaction in sync failure output, smoke-specific cron secret precedence, cron unauth smoke guarding, malformed reminder-cron count rejection, richer health-check diagnostics, and failure when live sync returns only a recoverable Discord warning, a non-Discord scheduled-event URL, or a Discord event URL with query/hash data.
- `tests/server/ops-check-workflow-policy.test.ts` covers the `ops:drift` guard for Node 24-native GitHub Actions majors in the CI workflow and keeps the final clean-main drift mode distinct from explicit PR-local drift evidence.
- `tests/server/vercel-env-audit.test.ts` covers feature-required Discord env keys, case-insensitive context parsing, unknown feature names failing closed, manual fallback feature-key output, manual fallback warnings for unknown feature names, sanitized Vercel CLI JSON parsing, REST/CLI env-record sanitization, script-boundary CLI fallback invocation, PATH preservation, explicit API-source no-fallback behavior, CLI failure-stderr redaction, and non-leakage of secret values in audit results and script output.
- `tests/lib/discord-studio-callback.test.ts` covers the `/studio?discord=...` feedback mapping, including `not_configured`, and verifies every callback status refreshes the Discord connection snapshot instead of leaving stale setup state in place.
- `tests/components/schedule-classes-box.test.tsx` covers hidden Discord UI without the teacher prop, not-configured state, channel save/disconnect, sync callbacks, warning/link rendering, unsafe event-link suppression including sensitive query-param links, and no-classroom disabled state.

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
- Sign in as a teacher, connect a disposable Discord server, and verify Studio returns with `?discord=connected`; before Discord app config exists, `?discord=not_configured` is the expected pre-credential readiness signal.
- Create or choose a future scheduled class with a linked classroom, sync it, and inspect Discord event name/time/location link.
- Edit and re-sync the class, then delete it and confirm the Discord scheduled event is removed or already gone.
- Use a near-term class and cron invocation to confirm the configured channel receives exactly one reminder.

## Current Blockers

- Live preview and production Discord smoke require real `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET` values. The latest secret-safe Vercel CLI fallback audit confirms all four Discord keys are missing in both preview and production. Record only variable presence, never secret values.
- Live smoke also requires a maintainer teacher account, a disposable Discord test server, bot install permissions, and a future teacher-owned scheduled class linked to a classroom.
- Final `v0.7.0` closeout requires a clean `main` gate run, production deployment ID, production smoke output, and `v0.7.0` tag.
