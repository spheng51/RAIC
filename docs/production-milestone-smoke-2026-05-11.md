# Production Milestone Smoke - 2026-05-11

This milestone verifies that `open-raic.com` is ready for authenticated classroom generation and
MiroFish simulation testing. It separates regressions from configuration blockers so production
checks can be repeated without guessing.

## Automated smoke

Run the non-destructive smoke:

```bash
pnpm smoke:production:milestone
```

Use this when known configuration blockers are acceptable but you still want the regression checks
to pass:

```bash
pnpm smoke:production:milestone -- --allow-blockers
```

The smoke checks:

- `/api/health` core readiness: auth, encryption, and Postgres storage.
- MiroFish readiness, reported as blocked when env vars are missing.
- `/api/server-providers` and `/api/ai/options` provider readiness.
- Current model registry exposure for OpenAI `gpt-5.5` and ElevenLabs `eleven_v3`.
- Friendly missing-key behavior for `/api/verify-model`.
- Teacher auth guard on `/api/generate-classroom`.
- Clean 404s for missing classroom, session context, collaboration state, and presentation state.

## Manual authenticated pass

Run this after a teacher can sign in at `/studio` and at least one server-backed LLM provider is
enabled.

- Sign in as a teacher and confirm `/studio` loads without redirecting to `/sign-in`.
- Open `/goal` or the studio creation flow and generate a small classroom.
- Poll the generation job until success and navigate only to `/classroom/<result.id>`.
- Verify these endpoints for the new classroom ID:
  - `/api/classroom?id=<id>`
  - `/api/classroom/<id>/session-context`
  - `/api/classroom/<id>/collaboration-state`
  - `/api/classroom/<id>/presentation-state`
- Create a join token, redeem it as a student, and confirm the student classroom opens.
- Send a teacher chat message and confirm no raw backend JSON is rendered.
- Reload the classroom and confirm slides, chat, collaboration, and presentation state recover.
- Open an old or missing classroom ID and confirm the UI shows the fatal classroom error state with
  no endless spinner.

## Simulation pass

Run this after MiroFish readiness is green in `/api/health`.

- Confirm the `Simulations` button is visible in a teacher/manager classroom.
- Open the simulation manager.
- Create or attach a MiroFish simulation.
- Reload the classroom and confirm the attached simulation persists.
- Confirm collaboration/presentation polling continues without 404 loops.
- Confirm control handoff works for the teacher/manager session.

## Current blocker interpretation

These are blockers, not product regressions:

- `/studio` redirects to `/sign-in` when no teacher session is present.
- `/api/generate-classroom` returns `401 UNAUTHORIZED` without teacher auth.
- `/api/ai/options` shows no enabled server-backed LLM provider with `hasSecret: true`.
- `/api/health.readiness.mirofish.ready` is false until MiroFish env vars are configured.

These are regressions:

- Production deployment is not `READY` or not aliased to `open-raic.com`.
- `/api/health` reports auth, encryption, or Postgres storage not ready.
- Current built-in models are missing from `/api/ai/options`.
- Missing classroom APIs return raw/HTML errors instead of clean 404 JSON.
- Missing classroom UI renders raw backend JSON or spins indefinitely.
