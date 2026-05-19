# Release Evidence: v0.6.0 Adaptive Student Beta Readiness

Date: 2026-05-18
Target release: `v0.6.0`
Evidence status: branch readiness evidence, not final tag evidence.

## Scope

`v0.6.0` prepares Adaptive Student Beta without enabling student-facing adaptation by default.

- Adds the `RAIC_STUDENT_ADAPTATION_BETA` operator flag with an unset/false default.
- Keeps teacher adaptive runtime context limited to authenticated teacher web access.
- Requires a future explicit consent path before student adaptive context can load.
- Preserves current public, anonymous, classroom-cookie, and signed-in student behavior.
- Defers Discord scheduled-class integration, duplicate file cleanup, demo video work, and game-arcade sequence work to separate slices.

## Local Branch Evidence

Environment:

- Branch: `codex/v0.6.0-student-beta-readiness`
- Base: `origin/main` at `990478126d27bb310678a00d6841392f588169e9`
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

## Non-Leakage Coverage

- `tests/server/adaptive-runtime-prompt.test.ts` proves the readiness flag defaults off, flag-only student access is insufficient, rollback to false blocks student adaptive context even with future consent, and authenticated teacher web access still loads context.
- `tests/server/chat-route.test.ts` covers teacher web adaptive context, public-demo chat, classroom-cookie student access, signed-in student web access, and flag-only student access.
- `tests/server/pbl-chat-route.test.ts` verifies PBL routes pass classroom access into the adaptive gate and remain non-adaptive for classroom-cookie access when the beta flag is on.
- `tests/server/generation-routes.test.ts` verifies scene content and scene actions pass request-derived classroom context into the adaptive gate and fail open when no adaptive prompt is available.

## Clean-Main Release Gates Remaining

The following ops scripts intentionally refused this scratch branch before running because they require local `main`:

- `npx -y node@24 /usr/local/bin/corepack pnpm run secrets:scan`
- `npx -y node@24 /usr/local/bin/corepack pnpm run ops:drift`

Both exited with:

```text
[ops-check] ERROR: Expected local branch to be 'main', found 'codex/v0.6.0-student-beta-readiness'.
```

Before tagging, merge the slice into clean local `main` and rerun the final release gate set there:

- `corepack pnpm run secrets:scan`
- `corepack pnpm run ops:drift`
- `corepack pnpm run benchmark:milestone` if final review treats the chat/prompt gate as latency-sensitive
- `corepack pnpm run ops:verify`
- production deployment and post-deploy smoke checks
