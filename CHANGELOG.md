# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
