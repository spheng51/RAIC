# Public Classroom Release Notes

## v0.2.0 Public Release

Release date: 2026-05-16

`v0.2.0` makes the current hosted classroom stack ready for public use on `open-raic.com`: teachers can publish shareable classrooms from local work, students can join public classroom sessions, and teachers can run auto-paced multiplayer game classes with review signals.

## Public Surface

- Public example classroom path is included for the launch branch and linked from the README.
- Hosted Make shareable keeps the public classroom API stable for existing local demo exports.
- Teacher publish warnings now explain skipped or oversized local media instead of silently dropping assets.
- Blob direct upload support preserves larger local publish assets when `BLOB_READ_WRITE_TOKEN` is configured.

## Multiplayer Classes

- Game sessions support arming, live play, pause/resume, completion, and reset.
- Live score, progress, complete, shared-state, and control-input submissions require the current `roundId`.
- Stale or non-live submissions are rejected before mutating game-session state.
- Teacher review focuses follow-up on active participants while keeping inactive players visible in leaderboard history.
- Shared-control assignment is disabled for inactive participants.

## Release Gates

Run the final gate on clean local `main` after the release PR lands:

```bash
corepack pnpm run secrets:scan
corepack pnpm run ops:drift
corepack pnpm run check
corepack pnpm run build
corepack pnpm run test:mirofish:gate
corepack pnpm run test:mirofish:e2e
CI=1 corepack pnpm run test:e2e
corepack pnpm run benchmark:milestone
corepack pnpm run ops:verify
```

After production deploy, run:

```bash
corepack pnpm run smoke:production:milestone
corepack pnpm run smoke:production:classroom
```

Then complete the signed-in manual checklist printed by the classroom smoke script for Make shareable, join-link entry, and multiplayer scheduling.

## Production Environment

Required Vercel production variables:

- `DATABASE_URL`
- `RAIC_SECRET_ENCRYPTION_KEY`
- `BLOB_READ_WRITE_TOKEN`
- `NEXT_PUBLIC_GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_ID`
- at least one production LLM provider key

Feature-scoped variables:

- Include MiroFish variables only if MiroFish is deployed in the public surface.
- Include Discord scheduled-class sync variables only if Discord class sync is included in the release.
- Include image, video, TTS, ASR, and search provider keys only for enabled public features.

## Deferred

- Discord scheduled-class sync is deferred to `v0.2.1` unless it is explicitly required by the deployed public classroom or multiplayer stack.
- Assets over 100 MB remain skipped until a larger durable upload policy is added.
