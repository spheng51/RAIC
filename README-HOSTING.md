# Open-RAIC Running & Hosting Guide

This guide is a quick, practical README focused on **running locally** and **hosting in production**.

## Hard Cutover

The legacy pre-cutover deployment path is retired. Production and staging deployment docs should now target the `spheng51/RAIC` repository and `open-raic.com` hostnames only.

- The access-code cookie name is now `openraic_access`. Deployments using `ACCESS_CODE` should expect a fresh site-level prompt after the cutover.
- The browser database name is now `RAIC-Database`, and the discarded-db marker is now `RAIC_DISCARDED_DB`.
- Same-origin browser state is not wiped automatically. Before validating a cutover on the same origin, clear cookies, IndexedDB, localStorage, and sessionStorage manually.
- Docker users must recreate the old volume or migrate it manually before bringing up the renamed stack. No automatic volume rename or import is provided.
- If `DATABASE_URL` is unset, copy the repo-local `data/` directory forward from the old checkout or move the deployment to Postgres before starting RAIC.
- OpenClaw users must reinstall or reconfigure the renamed `openraic` skill. Hosted OpenClaw generation is not supported in this cutover.

## 1) Run Locally

### Prerequisites

- Node.js **24.x** for parity with CI, Vercel runtime policy, and release/ops scripts
- pnpm **10+**

### Setup

```bash
git clone https://github.com/spheng51/RAIC.git
cd RAIC
pnpm install
cp .env.example .env.local
```

Add at least one model provider key in `.env.local` (example):

```env
OPENAI_API_KEY=sk-...
# or
ANTHROPIC_API_KEY=sk-ant-...
# or other supported providers
```

### Start development server

```bash
pnpm dev
```

Visit: `http://localhost:3000`

---

## 2) Production Run (Single Server)

Build and run the optimized Next.js app:

```bash
pnpm build
pnpm start
```

By default, Next.js serves on port `3000`.

---

## 3) Hosting Options

## Option A: Vercel (fastest)

1. Import GitHub repo `spheng51/RAIC` into Vercel.
2. Keep Git integration enabled so PRs receive preview deployments and merges to `main` deploy production.
3. Set required environment variables from `.env.example` (at least one provider API key).
4. Deploy.

Public launch on `open-raic.com`:

1. Keep GitHub as the source of truth and merge to `main` only through green PRs.
2. Protect `main` and require `Ops Drift`, `MiroFish Contract Gate`, `Lint, Typecheck & Unit Tests`, and `E2E Tests`.
3. Import GitHub repo `spheng51/RAIC` into Vercel with Git integration enabled.
4. Set required public-production Vercel environment variables:
   - `DATABASE_URL`
   - `RAIC_SECRET_ENCRYPTION_KEY`
   - `BLOB_READ_WRITE_TOKEN` for durable direct uploads of local publish media larger than the Vercel function payload budget
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_ID`
   - at least one production LLM provider key
   - any image/video/TTS/ASR/search provider keys needed for the public surface
   - MiroFish variables if MiroFish is part of the live deployment
   - Discord scheduled-class sync variables only if Discord class sync is part of this release
   - Keep the live Google sign-in IDs in `Production`; leave generic preview URLs out of teacher/admin auth unless you add a fixed staging domain with its own exact authorized origin.
- Hosted teacher and admin auth require a working `DATABASE_URL`. Without it, the JSON fallback only writes to temporary runtime storage and web identity/session state is not durable.
- Hosted local-demo publishing can create the shareable classroom without Blob storage, but local media/audio over the small per-function upload cap is only preserved when `BLOB_READ_WRITE_TOKEN` is configured. Without Blob, those large assets are skipped and shown in the teacher warning detail panel; assets over 100 MB remain skipped until a larger durable upload policy is added.
- Async classroom generation is currently kicked off with `after()` as a background follow-up, but that is not a durable worker queue. Treat the request `maxDuration` budget as request-scoped only, not as a guarantee for the classroom job lifetime.
- The classroom job runner currently uses per-process in-memory dedupe plus job files on the configured data root. On hosted serverless runtimes without durable backing storage, long classroom jobs remain best-effort and may be interrupted on restarts or cold starts.
5. Add `open-raic.com` as the production domain, with optional `www.open-raic.com` redirect only.
6. In Google Cloud OAuth, authorize `https://open-raic.com` and `https://www.open-raic.com` only if that hostname will actually serve the app.
   For local development, also authorize `http://localhost:3000` and `http://localhost:3005`.
   For this GIS ID-token flow, do not deploy a Google client secret.
7. Run the full local release gates on clean local `main` before each production merge:
   - `corepack pnpm run secrets:scan`
   - `corepack pnpm run ops:drift`
   - `VERCEL_PROJECT_ID=<project-id> VERCEL_TEAM_ID=<team-id> VERCEL_TOKEN=<token> corepack pnpm run ops:env:vercel`
   - `corepack pnpm run check`
   - `corepack pnpm run build`
   - `corepack pnpm run test:mirofish:gate`
   - `corepack pnpm run test:mirofish:e2e`
   - `CI=1 corepack pnpm run test:e2e`
   - `corepack pnpm run benchmark:milestone`
   - `corepack pnpm run ops:verify`
   - For releases where Discord scheduled-class sync is in scope, run the Vercel env audit with `VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord` for the target context before smoke sign-off.
   During PR hardening, `corepack pnpm run ops:drift:pr` can provide branch-local drift evidence from a feature worktree. It does not replace the final clean-`main` `ops:drift` or `ops:verify` gates.
8. Merge to `main`, let Vercel deploy production automatically, then smoke-check the auth and governed surfaces before declaring the release healthy:
   - Signed out: `/studio` redirects to `/sign-in?next=%2Fstudio`
   - Signed out: `/admin` redirects to `/sign-in?next=%2Fadmin`
   - Signed in as teacher: `/sign-in` lands on `/studio`
   - Signed in as teacher with `next=/admin`: the flow ends on `/unauthorized`, not the admin console
   - Signed in as org admin: `/sign-in` lands on `/admin`
   - Signed in as org admin: `/admin` loads and can save org AI config
   - Signed in as teacher: Studio settings show governed provider state without exposing org secrets
   - Sign-out clears the web session and classroom cookies
   - One classroom flow still works end to end
   - `corepack pnpm run smoke:production:milestone` passes against the production origin
   - `corepack pnpm run smoke:production:classroom` passes its automated guard checks, then complete the signed-in manual checklist it prints for Make shareable, join-link entry, and multiplayer scheduling
   - For the Discord scheduled-class beta, run `corepack pnpm run smoke:discord-beta -- --allow-blockers` before credentials are available, adding `RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN` when the preview is behind Vercel deployment protection. A pre-credential callback can return `?discord=not_configured`; treat that as the expected readiness signal until Discord env exists. Then rerun `corepack pnpm run smoke:discord-beta` with a signed-in teacher cookie, Discord test server, scheduled class id, and cron secret before production sign-off, where the callback should return `?discord=connected`.
   - Optional feature smokes are skipped unless required. To make a feature release-blocking, set `RAIC_REQUIRED_PRODUCTION_FEATURES=mirofish,tts,image,video,websearch` or the specific `RAIC_REQUIRE_<FEATURE>_SMOKE=true` flag before running the milestone smoke.
9. Roll back with Vercel if production is unhealthy.

Recommended when you want easiest CI/CD and global edge delivery.

## Option B: Docker

Use included Docker setup:

```bash
cp .env.example .env.local
# fill in provider keys

docker compose up --build
```

Hard-cutover note: if you previously ran the legacy stack, recreate the old Docker volume or migrate its data manually before starting RAIC. The renamed deployment does not adopt legacy volumes automatically.

Recommended for self-hosting on a VPS or internal server.

## Option C: Traditional VM / Bare Metal

1. Install Node.js 24.x + pnpm 10+.
2. Clone repo, copy the previous `data/` directory forward if `DATABASE_URL` is unset, and configure `.env.local`.
3. Run `pnpm build && pnpm start`.
4. Put Nginx/Caddy in front for TLS and reverse proxy.
5. Use a process manager (systemd/pm2) for uptime.

---

## 4) Environment Variables

Start from `.env.example` and only add values you need.

Minimum for useful deployment:

- One LLM provider key (for example `OPENAI_API_KEY`)

Recommended for managed org configuration:

- `DATABASE_URL` (required for public production)
- `RAIC_SECRET_ENCRYPTION_KEY` (enables encrypted org-managed provider secrets)
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`

Production Vercel env audit:

```bash
VERCEL_PROJECT_ID=prj_... \
VERCEL_TEAM_ID=team_... \
VERCEL_TOKEN=... \
corepack pnpm run ops:env:vercel
```

The audit prints only present/missing key names, never secret values. If Vercel auth or env listing is unavailable, use the printed manual fallback checklist in the Vercel dashboard and record only presence status.

Discord beta Vercel env audit:

```bash
VERCEL_PROJECT_ID=prj_... \
VERCEL_TEAM_ID=team_... \
VERCEL_TOKEN=... \
VERCEL_ENV_AUDIT_CONTEXTS=preview \
VERCEL_ENV_AUDIT_REQUIRED_FEATURES=discord \
corepack pnpm run ops:env:vercel
```

For production Discord beta sign-off, repeat with `VERCEL_ENV_AUDIT_CONTEXTS=production` after the preview smoke has passed.

Optional advanced parsing:

- `PDF_MINERU_BASE_URL`
- `PDF_MINERU_API_KEY` (if your MinerU endpoint requires auth)

Optional production features:

- `MIROFISH_BASE_URL`
- `MIROFISH_API_BASE_URL`
- `MIROFISH_API_KEY`
- `MIROFISH_EMBED_SECRET`
- `MIROFISH_AUTHORING_ENABLED` (teacher-server AI-guided creation inside the classroom MiroFish dialog)
- `MIROFISH_MULTI_USER_ENABLED`
- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_BOT_TOKEN`, and `CRON_SECRET` for Discord scheduled-class sync and reminders

Discord beta smoke inputs are operator-only local values:

- `RAIC_DISCORD_SMOKE_BASE_URL` chooses the preview or production origin.
- `RAIC_DISCORD_SMOKE_COOKIE` is the full signed-in teacher `Cookie` header used only for the smoke run.
- `RAIC_DISCORD_SMOKE_CONNECTION_ID` and `RAIC_DISCORD_SMOKE_CHANNEL_ID` automate channel save.
- `RAIC_DISCORD_SMOKE_EVENT_ID` automates syncing one future teacher-owned scheduled class with a linked classroom.
- `RAIC_DISCORD_SMOKE_CRON_SECRET` is preferred over `CRON_SECRET` for smoke cron invocation.
- `RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN` optionally bypasses Vercel deployment protection for preview API smoke. Keep it operator-local and do not store it in project env.

Protected preview example:

```bash
read -rs RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN
export RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN
RAIC_DISCORD_SMOKE_BASE_URL=https://<preview>.vercel.app corepack pnpm run smoke:discord-beta -- --allow-blockers
```

If you enable `MIROFISH_AUTHORING_ENABLED`, the MiroFish wrapper also needs to expose:

- `POST /api/authoring/publish`
- `GET /api/authoring/jobs/:jobId`

Health checks distinguish embed readiness from authoring readiness. Before validating the AI-guided
creation flow, confirm `/api/health` reports both `readiness.mirofish.ready` and
`readiness.mirofish.authoringReady` as `true`.

---

## 5) Basic Ops Checklist

- Run behind HTTPS.
- Use RAIC hostnames only in OAuth config, smoke tests, and support runbooks. Do not keep any legacy pre-cutover domains live during the hard cutover.
- Before same-origin smoke tests, manually clear cookies, IndexedDB, localStorage, and sessionStorage so stale browser state does not contaminate the cutover validation.
- Expect the `openraic_access` cookie, `RAIC-Database`, and `RAIC_DISCARDED_DB` keys to replace their pre-cutover names.
- Keep generic Vercel preview URLs out of teacher/admin auth sign-off unless you add a fixed staging domain.
- Treat auth smoke checks as release blockers for admin/settings work. Do not sign off a deploy until the signed-out redirect, teacher unauthorized path, org-admin landing path, and sign-out cookie clearing have all been verified on the exact deployed origin.
- Restrict who can access admin surfaces.
- Rotate API keys regularly.
- Monitor logs and restart policy.
- Keep dependencies updated (`pnpm up` on a regular schedule).
- Keep secrets only in Vercel environment variables, not in repo files or `NEXT_PUBLIC_*`.
- Reinstall or reconfigure the renamed `openraic` OpenClaw skill anywhere classroom launches depend on chat-side automation. Use the hosted web UI directly until a machine-usable hosted auth flow is added for the skill.

---

## 6) Useful Commands

```bash
pnpm dev         # local development
pnpm build       # production build
pnpm start       # start production server
pnpm lint        # lint checks
pnpm test        # unit tests
```

If you need deeper product details (features, architecture, provider matrix), refer to the main [`README.md`](./README.md).
