# OpenMAIC Running & Hosting Guide

This guide is a quick, practical README focused on **running locally** and **hosting in production**.

## 1) Run Locally

### Prerequisites

- Node.js **20.9+**
- pnpm **10+**

### Setup

```bash
git clone https://github.com/THU-MAIC/OpenMAIC.git
cd OpenMAIC
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

1. Fork this repo.
2. Import into Vercel.
3. Set required environment variables from `.env.example` (at least one provider API key).
4. Deploy.

Recommended when you want easiest CI/CD and global edge delivery.

## Option B: Docker

Use included Docker setup:

```bash
cp .env.example .env.local
# fill in provider keys

docker compose up --build
```

Recommended for self-hosting on a VPS or internal server.

## Option C: Traditional VM / Bare Metal

1. Install Node.js + pnpm.
2. Clone repo and configure `.env.local`.
3. Run `pnpm build && pnpm start`.
4. Put Nginx/Caddy in front for TLS and reverse proxy.
5. Use a process manager (systemd/pm2) for uptime.

---

## 4) Environment Variables

Start from `.env.example` and only add values you need.

Minimum for useful deployment:

- One LLM provider key (for example `OPENAI_API_KEY`)

Recommended for managed org configuration:

- `RAIC_SECRET_ENCRYPTION_KEY` (enables encrypted org-managed provider secrets)

Optional advanced parsing:

- `PDF_MINERU_BASE_URL`
- `PDF_MINERU_API_KEY` (if your MinerU endpoint requires auth)

---

## 5) Basic Ops Checklist

- Run behind HTTPS.
- Restrict who can access admin surfaces.
- Rotate API keys regularly.
- Monitor logs and restart policy.
- Keep dependencies updated (`pnpm up` on a regular schedule).

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
