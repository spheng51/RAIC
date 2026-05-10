# Model List Audit - 2026-05-10

checkedAt: 2026-05-10

Scope: LLM, image, video, TTS, ASR, PDF, and web search registries exposed by Open-RAIC settings and generation flows.

## Sources Checked

- OpenAI models: https://platform.openai.com/docs/models and https://developers.openai.com/api/docs/models/gpt-5.5
- OpenAI Sora video: https://developers.openai.com/api/docs/guides/video-generation and https://platform.openai.com/docs/models/sora-2
- Anthropic Claude models: https://docs.anthropic.com/en/docs/about-claude/models/all-models and https://platform.claude.com/docs/en/about-claude/models/whats-new-claude-4-6
- Gemini text/image/video: https://ai.google.dev/gemini-api/docs/models, https://ai.google.dev/gemini-api/docs/image-generation, https://ai.google.dev/gemini-api/docs/video, and https://cloud.google.com/vertex-ai/generative-ai/docs/models/veo/3-1-generate-preview
- DeepSeek pricing/models: https://api-docs.deepseek.com/quick_start/pricing
- xAI models: https://docs.x.ai/docs/models and https://docs.x.ai/developers/rest-api-reference/inference/models
- Kimi model list: https://platform.kimi.ai/docs/models
- GLM / Aliyun cross-listing: https://docs.bigmodel.cn/cn/guide/start/model-overview and https://help.aliyun.com/zh/model-studio/text-generation-model/
- Qwen Model Studio: https://help.aliyun.com/zh/model-studio/text-generation-model/
- ElevenLabs models: https://elevenlabs.io/docs/models
- Vercel AI Gateway models, cross-check only: https://vercel.com/ai-gateway/models

## Changes Made

- Added `lib/ai/providers-current.ts` as the current LLM registry overlay. It preserves the existing direct-provider implementation in `lib/ai/providers.ts` and refreshes built-in model lists without migrating to Vercel AI Gateway.
- Added `lib/audio/constants-current.ts` as the current audio registry overlay for settings/UI model lists.
- Routed exact imports for `@/lib/ai/providers` and `@/lib/audio/constants` through the overlays in `tsconfig.json`.
- Added current LLM IDs: `gpt-5.5`, `claude-opus-4-7`, `gemini-3.1-flash-lite`, `qwen3.6-max-preview`, `qwen3.6-plus`, `qwen3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `glm-5.1`, `kimi-k2.6`, `grok-4.3`, `grok-4.20-0309-reasoning`, and `grok-4.20-0309-non-reasoning`.
- Kept older compatible model IDs in place so saved settings do not break.
- Updated Grok aliases so saved Grok 4.20 beta IDs normalize to the current exact xAI IDs.
- Added current ElevenLabs TTS IDs `eleven_v3` and `eleven_turbo_v2_5` while preserving `eleven_multilingual_v2` as the stable default.
- Added current xAI image model `grok-imagine-image-quality` and kept `grok-imagine-image-pro` as a legacy selectable ID for existing users.
- Updated Veo to prefer `veo-3.1-generate-preview` and `veo-3.1-fast-generate-preview` while preserving older `-001` IDs.
- Added Sora 2 model IDs and a direct OpenAI Sora video adapter using `POST /videos`, `GET /videos/{video_id}`, and `GET /videos/{video_id}/content`.

## Cache And Governance Notes

- Persisted settings already call `ensureBuiltInProviders()` on rehydrate, which prepends newly added built-in LLM models into saved provider configs without asking users to clear browser cache.
- Server-governed `serverModels` are still applied after built-in merge through `mergeAllowedLLMModels()` and downstream validation, so organization-managed model restrictions continue to win.
- Image/video/audio provider config records are preserved; the registry model arrays feed the selector UI and server default fallback behavior.

## Non-Model Registries

- ASR remains current for existing configured providers: OpenAI Whisper/transcribe, Qwen ASR, and browser-native ASR.
- PDF remains provider-based, not model-based: `unpdf` and `MinerU` are present.
- Web search remains provider-based, not model-based: Tavily is present at `https://api.tavily.com`.

## Verification Targets

- `tests/lib/ai-providers.test.ts` checks the audited OpenAI ordering and date marker.
- `tests/ai/grok-provider-aliases.test.ts` checks updated Grok alias normalization.
- `tests/lib/model-registry-audit.test.ts` checks the dated LLM, media, audio, PDF, and web search registry surfaces.
- Production smoke should confirm settings render, cached settings rehydrate with new built-ins, server-governed model restrictions still filter UI lists when configured, and unavailable keys return friendly errors.
