import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY_CHECKED_AT, PROVIDERS } from '@/lib/ai/providers';
import { AUDIO_MODEL_REGISTRY_CHECKED_AT, TTS_PROVIDERS } from '@/lib/audio/constants';
import { IMAGE_MODEL_REGISTRY_CHECKED_AT, IMAGE_PROVIDERS } from '@/lib/media/image-providers';
import { VIDEO_MODEL_REGISTRY_CHECKED_AT, VIDEO_PROVIDERS } from '@/lib/media/video-providers';
import { PDF_PROVIDERS } from '@/lib/pdf/constants';
import { WEB_SEARCH_PROVIDERS } from '@/lib/web-search/constants';

function ids(models: Array<{ id: string }>): string[] {
  return models.map((model) => model.id);
}

describe('model registry audit 2026-05-10', () => {
  it('records the audited registry date', () => {
    expect(MODEL_REGISTRY_CHECKED_AT).toBe('2026-05-10');
    expect(AUDIO_MODEL_REGISTRY_CHECKED_AT).toBe('2026-05-10');
    expect(IMAGE_MODEL_REGISTRY_CHECKED_AT).toBe('2026-05-10');
    expect(VIDEO_MODEL_REGISTRY_CHECKED_AT).toBe('2026-05-10');
  });

  it('exposes current LLM model IDs from the official provider docs', () => {
    expect(ids(PROVIDERS.openai.models)).toContain('gpt-5.5');
    expect(ids(PROVIDERS.anthropic.models)).toContain('claude-opus-4-7');
    expect(ids(PROVIDERS.google.models)).toContain('gemini-3.1-flash-lite');
    expect(ids(PROVIDERS.qwen.models)).toEqual(
      expect.arrayContaining(['qwen3.6-max-preview', 'qwen3.6-plus', 'qwen3.6-flash']),
    );
    expect(ids(PROVIDERS.deepseek.models)).toEqual(
      expect.arrayContaining(['deepseek-v4-pro', 'deepseek-v4-flash']),
    );
    expect(ids(PROVIDERS.glm.models)).toContain('glm-5.1');
    expect(ids(PROVIDERS.kimi.models)).toContain('kimi-k2.6');
    expect(ids(PROVIDERS.grok.models)).toEqual(
      expect.arrayContaining([
        'grok-4.3',
        'grok-4.20-0309-reasoning',
        'grok-4.20-0309-non-reasoning',
      ]),
    );
  });

  it('exposes current media and audio model IDs without removing compatible legacy IDs', () => {
    expect(ids(TTS_PROVIDERS['elevenlabs-tts'].models)).toEqual(
      expect.arrayContaining(['eleven_v3', 'eleven_turbo_v2_5', 'eleven_multilingual_v2']),
    );
    expect(ids(IMAGE_PROVIDERS['grok-image'].models)).toEqual(
      expect.arrayContaining(['grok-imagine-image-quality', 'grok-imagine-image']),
    );
    expect(ids(VIDEO_PROVIDERS.veo.models)).toEqual(
      expect.arrayContaining(['veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview']),
    );
    expect(ids(VIDEO_PROVIDERS.sora.models)).toEqual(
      expect.arrayContaining(['sora-2', 'sora-2-pro']),
    );
  });

  it('keeps non-model provider registries present for settings UI smoke', () => {
    expect(PDF_PROVIDERS.unpdf).toBeDefined();
    expect(PDF_PROVIDERS.mineru).toBeDefined();
    expect(WEB_SEARCH_PROVIDERS.tavily.defaultBaseUrl).toBe('https://api.tavily.com');
  });
});
