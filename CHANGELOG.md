# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.5.0] - 2026-05-17

`v0.5.0` introduces Source-Grounded Experience Presets, starting with History Vlog, and hardens source visibility and source-backed generation guardrails.

### Added

- History Vlog course preset for fictional time-traveler/vlogger narration with source-backed fact checks, reconstruction labels, AI caveats, and normal slide/quiz/interactive scenes.
- Lightweight classroom source visibility metadata and UI labels showing whether a generated classroom used PDF context, web search context, both, or neither.
- Reusable experience preset registry for source requirements, prompt context, UI chip metadata, and validation copy.

### Changed

- History Vlog generation now fails clearly without source context while allowing PDF fallback when web search is unavailable.
- Preset prompt wiring now reinforces no invented citations, humane treatment of historical trauma, media-literacy moments, and source-literacy quiz coverage.

### Testing

- Regression coverage now includes PDF-only History Vlog generation, web-search failure with PDF fallback, Game mode preset clearing, scene action media-literacy prompts, and no-invented-citation prompt assertions.

## [0.4.0] - 2026-05-17

`v0.4.0` closes the Reliable Adaptive Learning Platform milestone by making adaptive classroom generation more governable, adding private teacher analytics, and preserving public/student API stability.

### Added

- Provider Composer scenario routing now covers scene outline, scene content, and scene action generation.
- Private teacher/internal learning analytics summarize aggregate quality signals from existing session context and reflection records.
- Release notes and roadmap docs now capture the v0.4.0 closeout, Node 24 runtime policy, and next hardening milestones.

### Changed

- Scenario-managed verification and generation paths fail closed with governed 4xx errors when no valid managed candidate remains.
- Provider scenario telemetry records selected, fallback, denied, and validation status metadata for release diagnostics.
- Legacy browser-key model verification remains available only for the documented one-release fallback path when a teacher explicitly tests a local key/base URL.

### Operations

- Public/student HTTP request and response payload shapes remain unchanged.
- Adaptive Student Beta is deferred until privacy, consent, retention, feature-flag, rollback, and non-leakage review is complete.
- Final release evidence should include clean-main Node 24 `ops:verify`, benchmark output, production deployment ID, production smokes, and signed-in classroom QA.

## [0.3.0] - 2026-05-16

`v0.3.0` activates teacher-only Adaptive Classroom Intelligence for repeated classroom sessions.

### Added

- Teacher-managed classroom generation now reuses prior session context and reflection summaries when the same teacher repeats a matching requirement.
- Outline and scene generation prompts receive adaptive context for repeated-session teachers without changing public generation request payloads.
- Replay coverage verifies adaptive prompt markers for last completed segment, mastery hints, revisit/remediation intent, and latest reflection summary.

### Changed

- Session progress capture and the session reflection dialog remain teacher-only and continue to fail open for public demo, anonymous, student, and classroom-cookie flows.
- Provider Composer, Discord scheduled-class sync, and student-facing analytics remain deferred to later milestones.

### Operations

- No new Vercel environment variables are required; continue using `pnpm run ops:env:vercel` before production release.
- Final release gates still require a clean local `main`, benchmark evidence, and `ops:verify`.

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
