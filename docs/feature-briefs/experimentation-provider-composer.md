# Feature Brief: Experimentation & Provider Composer

## Intent

Add safe composition tooling for provider experiments that lets advanced workflows mix provider variants for different classroom tasks while staying inside the existing provider configuration contract.

## User Stories

- As a platform experimenter, I want to test media/voice/agent providers by scenario without changing user-facing route contracts.
- As a performance engineer, I want provider capability checks to happen before use so unstable provider mixes do not degrade classroom reliability.
- As a maintainer, I want quick rollback for provider routing changes.

## Proposed Capabilities

1. Local scenario profile layer that maps classroom task buckets (voice, image, scene, transcript) to preferred provider candidates.
2. Deterministic provider capability checks for candidate combinations.
3. Per-scenario fallback policy and telemetry tags for faster diagnosis.

## Non-Goals

- No provider-API contract changes.
- No new credential models for current provider categories.
- No change to `/api/server-providers` payload shape.

## Acceptance Criteria

- Provider selection in new scenario paths emits explicit validation telemetry and fails closed when required credentials are missing.
- Unit tests cover capability validation and fallback behavior for missing/bad credentials.
- No measurable regression on existing `test:mirofish:gate` flow timings after merge.

## Milestone 2 Prep Packet

| Route | Task bucket | Current resolver and governance path | Deterministic validation requirement | Fail-closed rule | Required telemetry |
| --- | --- | --- | --- | --- | --- |
| `/api/generate/scene-outlines-stream` | `scene` | `resolveModelFromHeaders` -> `streamLLM` | Validate the routed text model, output window, and optional vision support before scenario selection | If the scenario-selected model is missing approval or credentials, keep the current governance error path and skip fallback unless a validated candidate exists | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/generate/scene-content` | `scene` | `resolveModelFromHeaders` -> `generateSceneContent` | Validate text-generation capability and optional vision support for assigned PDF images before provider use | Reject the request when the selected candidate cannot satisfy governed credentials or required capabilities | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/generate/scene-actions` | `scene` | `resolveModelFromHeaders` -> `generateSceneActions` | Validate text-generation capability, output window, and classroom latency budget eligibility before provider use | Reject the request when no validated candidate remains after capability checks | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/web-search` | `webSearch` | `resolveGovernedProviderConfig(family='webSearch')` -> `searchWithTavily`, with optional `resolveModelFromHeaders` query rewrite | Validate search-provider credentials first and treat any rewrite-model validation as a separate best-effort check until routing goes live | Fail closed if the scenario-managed search provider lacks governed credentials; do not silently downgrade to an unmanaged provider | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/transcription` | `transcript` | `resolveGovernedProviderConfig(family='asr')` -> `transcribeAudio` | Validate ASR provider, model, and governed base URL before provider use | Reject when credentials, model approval, or SSRF validation fail | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/generate/tts` | `tts` | `resolveGovernedProviderConfig(family='tts')` -> `generateTTS` | Validate voice-capable provider and model pair before provider use | Reject when the selected candidate lacks credentials or when the requested path falls back to browser-native TTS | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/generate/image` | `image` | `resolveGovernedProviderConfig(family='image')` -> `generateImage` | Validate image generation capability, governed credentials, and approved base URL before provider use | Reject when no validated image candidate remains; do not silently reuse the header default | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/generate/video` | `video` | `resolveGovernedProviderConfig(family='video')` -> `generateVideo` | Validate video generation capability, approved model, and option normalization support before provider use | Reject when the selected provider lacks approved credentials or validated model support | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/verify-model` | `scene` | `resolveModel` -> `generateText` | Validate the scenario-selected text model with the same governed resolution path used by classroom text generation | Reject when validation fails; verification must not silently swap to an unmanaged fallback | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/verify-image-provider` | `image` | `resolveGovernedProviderConfig(family='image')` -> `testImageConnectivity` | Validate the exact provider and model pair selected by the scenario profile before connectivity testing | Reject when credentials are missing or the candidate has not passed deterministic capability checks | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |
| `/api/verify-video-provider` | `video` | `resolveGovernedProviderConfig(family='video')` -> `testVideoConnectivity` | Validate the exact provider and model pair selected by the scenario profile before connectivity testing | Reject when credentials are missing or the candidate has not passed deterministic capability checks | `scenarioProfileId`, `taskBucket`, `routeId`, `selectedProviderId`, `selectedModelId`, `fallbackProviderId`, `fallbackModelId`, `fallbackReason`, `validationStatus` |

## Execution Order

1. Verification routes land first.
2. Web search, transcription, and TTS land second.
3. Image and video generation land third.
4. Scene generation routes land last because they are the most classroom-latency-sensitive.

## Routing Rules Locked For Milestone 2

- `server-provider-scenarios.yml` stays the baseline profile source.
- Environment variables override only the buckets they explicitly set.
- Scenario-managed routes must validate capability and credentials before provider use.
- Missing credentials fail closed on scenario-managed paths.
- Scenario resolution and fallback emit explicit internal audit telemetry.
- `/api/server-providers` and existing request or response payloads remain unchanged.

## Rollback Condition

- Revert the slice if provider selection bugs produce incorrect provider availability in managed paths or if fallback loops appear in e2e traces.
