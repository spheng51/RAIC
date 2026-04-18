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

- Node.js **20.9+**
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
   - `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_ID`
   - at least one production LLM provider key
   - any image/video/TTS/ASR/search provider keys needed for the public surface
   - MiroFish variables if MiroFish is part of the live deployment
5. Add `open-raic.com` as the production domain, with optional `www.open-raic.com` redirect only.
6. In Google Cloud OAuth, authorize `https://open-raic.com` and `https://www.open-raic.com` only if that hostname will actually serve the app.
7. Run the full local release gates on `main` before each production merge:
   - `corepack pnpm run secrets:scan`
   - `corepack pnpm run ops:drift`
   - `corepack pnpm run check`
   - `corepack pnpm run build`
   - `corepack pnpm run test:mirofish:gate`
   - `corepack pnpm run test:mirofish:e2e`
   - `$env:CI='1'; corepack pnpm run test:e2e`
   - `corepack pnpm run ops:verify`
8. Merge to `main`, let Vercel deploy production automatically, then smoke-check `/`, `/studio`, `/admin`, and one classroom flow.
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

1. Install Node.js + pnpm.
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

Optional advanced parsing:

- `PDF_MINERU_BASE_URL`
- `PDF_MINERU_API_KEY` (if your MinerU endpoint requires auth)

Optional production features:

- `MIROFISH_BASE_URL`
- `MIROFISH_API_BASE_URL`
- `MIROFISH_API_KEY`
- `MIROFISH_EMBED_SECRET`
- `MIROFISH_MULTI_USER_ENABLED`

---

## 5) Basic Ops Checklist

- Run behind HTTPS.
- Use RAIC hostnames only in OAuth config, smoke tests, and support runbooks. Do not keep any legacy pre-cutover domains live during the hard cutover.
- Before same-origin smoke tests, manually clear cookies, IndexedDB, localStorage, and sessionStorage so stale browser state does not contaminate the cutover validation.
- Expect the `openraic_access` cookie, `RAIC-Database`, and `RAIC_DISCARDED_DB` keys to replace their pre-cutover names.
- Keep generic Vercel preview URLs out of teacher/admin auth sign-off unless you add a fixed staging domain.
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
