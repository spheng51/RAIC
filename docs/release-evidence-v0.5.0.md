# Release Evidence: v0.5.0 Source-Grounded Experience Presets

Date: 2026-05-18
Target release: `v0.5.0`
Release decision: publish `v0.5.0` as the next public release after `v0.3.0`; do not backfill a separate `v0.4.0` tag. The release notes should call out that the `v0.5.0` tag includes the completed v0.4.0 Reliable Adaptive Learning Platform work plus Source-Grounded Experience Presets.

## Merge Evidence

- Merged PR: [#50 feat: add source-grounded experience presets](https://github.com/spheng51/RAIC/pull/50)
- Merge commit: `cf43f8df48c5c17f7545c75121200760af5d1071`
- CI run: [26003936426](https://github.com/spheng51/RAIC/actions/runs/26003936426)
- Vercel deployment: [6EshuFaAqvkWSoctBbS65vDmZcbW](https://vercel.com/vangorestudios-6959s-projects/raic/6EshuFaAqvkWSoctBbS65vDmZcbW)

## Local Release Gate

Environment:

- Clean single-branch clone of `main` at `cf43f8df48c5c17f7545c75121200760af5d1071`
- Node `v24.15.0`
- pnpm `10.28.0`

Passed gates:

- `corepack pnpm run secrets:scan`
- `corepack pnpm run ops:drift`
- `corepack pnpm run check`
- `corepack pnpm lint`
- `corepack pnpm run build`
- `corepack pnpm run test:mirofish:gate`
- `corepack pnpm run test:mirofish:e2e`
- `CI=1 corepack pnpm run test:e2e`
- `corepack pnpm run benchmark:milestone`
- `corepack pnpm run ops:verify`

Benchmark evidence:

- Artifact ID: `f6eae081-47c8-46d5-a10c-6766a6a12d29`
- Scope: `multiplayer-game-review`
- Source: `local-playwright-milestone`
- Status: `pass`

## History Vlog Guardrail

The final review fix for PR #50 requires usable PDF text before PDF counts as History Vlog source context. `pdfFileName` remains display metadata only and no longer satisfies the History Vlog source gate or contributes PDF to `sourceMode`.

Covered source paths:

- Filename-only History Vlog requests without web search are rejected at the route.
- Server-side History Vlog generation rejects filename-only PDF metadata when no usable web/PDF context exists.
- If web search fails, local/server fallback only accepts parsed PDF text.
- Existing PDF-only generation with `pdfContent.text.trim()` still passes.
- Existing web-only History Vlog generation still passes.

## Post-Release Watch

- Monitor History Vlog source-required failures for confusing teacher UX.
- Watch web-search failure fallback rates and source-mode metadata in generated classrooms.
- Keep `v0.5.1` limited to bug fixes, docs, telemetry clarity, smoke coverage, and small source-required UX improvements.
- Keep Adaptive Student Beta deferred to `v0.6.0` pending privacy, consent, retention, public API, feature-flag, rollback, and non-leakage review.
