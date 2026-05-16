# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.1] - 2026-05-16

`v0.2.1` stabilizes the public release lane after the `v0.2.0` production deploy.

### Added

- `pnpm run ops:env:vercel`, a secret-safe Vercel production environment audit that reports required key presence without printing values.
- Focused unit coverage for Vercel env audit parsing, missing-key reporting, context selection, and secret redaction.

### Changed

- Production milestone smoke checks now validate whichever server-backed LLM is actually enabled instead of assuming a fixed OpenAI model ID.
- MiroFish, TTS, image, video, and web-search smoke readiness are optional unless explicitly required by `RAIC_REQUIRED_PRODUCTION_FEATURES` or `RAIC_REQUIRE_<FEATURE>_SMOKE=true`.
- Provider error smoke coverage now probes an unconfigured provider and accepts friendly 400-level provider errors instead of failing when a server key makes the configured provider valid.

### Operations

- Vercel env audit reads `VERCEL_PROJECT_ID`, optional `VERCEL_TEAM_ID`, and `VERCEL_TOKEN`/`VERCEL_API_TOKEN`; when auth or env listing is unavailable it prints a manual dashboard fallback checklist.
- Public API surfaces remain unchanged from `v0.2.0`.

## [0.2.0] - 2026-05-16

`v0.2.0` is the first production-ready public classroom release milestone, focused on durable hosted publishing, public example classrooms, and multiplayer game-class readiness.

### Added

- Public Open-RAIC example classroom flow with release-facing README links and hosted cutover notes.
- Durable local classroom publish uploads with Vercel Blob direct upload support for larger local media assets.
- Auto-paced multiplayer game rounds with arming, live, pause/resume, completion, and teacher review states.
- `pnpm benchmark:milestone`, which records current multiplayer benchmark evidence for `ops:verify`.

### Changed

- Classroom publish APIs preserve stable shareable-classroom behavior while returning upload warnings for skipped or oversized media.
- Multiplayer game-session submissions now require `roundId` for live score, progress, complete, shared-state, and control-input events.
- Multiplayer review surfaces focus teacher follow-up on active participants while retaining inactive leaderboard history.

### Fixed

- Reject stale or non-live multiplayer game events before they can mutate score/progress state.
- Debounce player progress events and clear pending progress when score, completion, or round changes supersede it.
- Harden production classroom smoke checks for hosted Make shareable, join-link entry, and multiplayer scheduling coverage.

### Operations

- Public production requires `DATABASE_URL`, `RAIC_SECRET_ENCRYPTION_KEY`, `BLOB_READ_WRITE_TOKEN`, Google OAuth client IDs, and at least one LLM provider key.
- MiroFish and Discord environment variables are release-scoped only when those surfaces are included in the deployed public stack.
- Final release gates must run from clean local `main`; `ops:verify` intentionally refuses off-main verification.

## [0.1.0] - 2026-03-26

The first `0.1.0` release record of Open-RAIC, carrying forward the launch improvements from the initial open-source release.

### Highlights

- **Discussion TTS** — Voice playback during discussion phase with per-agent voice assignment, supporting all TTS providers including browser-native (PR #211)
- **Immersive Mode** — Full-screen view with speech bubbles, auto-hide controls, and keyboard navigation (PR #195, by @YizukiAme)
- **Discussion buffer-level pause** — Freeze text reveal without aborting the AI stream (PR #129, by @YizukiAme)
- **Keyboard shortcuts** — Comprehensive roundtable controls: T/V/Esc/Space/M/S/C (PR #256, by @YizukiAme)
- **Whiteboard enhancements** — Pan, zoom, auto-fit (PR #31), history and auto-save (PR #40, by @YizukiAme)
- **New providers** — ElevenLabs TTS (PR #134, by @nkmohit), Grok/xAI for LLM, image, and video (PR #113, by @KanameMadoka520)
- **Server-side generation** — Media and TTS generation on the server (PR #75, by @cosarah)
- **1.25x playback speed** (PR #131, by @YizukiAme)
- **OpenClaw integration** — Generate classrooms from Feishu, Slack, Telegram, and 20+ messaging apps (PR #4, by @cosarah)
- **Vercel one-click deploy** (PR #2, by @cosarah)

### Security

- Fix SSRF and credential forwarding via client-supplied baseUrl (PR #30, by @Wing900)
- Use resolved API key in chat route instead of client-sent key (PR #221)

### Testing

- Add Vitest unit testing infrastructure (PR #144)
- Add Playwright e2e testing framework (PR #229)

### New Contributors

@YizukiAme, @nkmohit, @KanameMadoka520, @Wing900, @Bortlesboat, @JokerQianwei, @humingfeng, @tsinglua, @mehulmpt, @ShaojieLiu, @Rowtion
