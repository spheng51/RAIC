import { describe, expect, it } from 'vitest';

import { getProvider } from '@/lib/ai/providers';

describe('MiniMax provider defaults', () => {
  it('uses the Anthropic-compatible v1 endpoint by default', () => {
    expect(getProvider('minimax')?.defaultBaseUrl).toBe('https://api.minimaxi.com/anthropic/v1');
  });

  it('matches the official Anthropic-compatible MiniMax model list', () => {
    const modelIds = getProvider('minimax')?.models.map((model) => model.id) ?? [];
    expect(modelIds).toEqual([
      'MiniMax-M2',
      'MiniMax-M2.1',
      'MiniMax-M2.1-highspeed',
      'MiniMax-M2.5',
      'MiniMax-M2.5-highspeed',
      'MiniMax-M2.7',
      'MiniMax-M2.7-highspeed',
    ]);
  });
});

describe('LM Studio provider defaults', () => {
  it('uses the local OpenAI-compatible endpoint by default', () => {
    expect(getProvider('lmstudio')).toMatchObject({
      defaultBaseUrl: 'http://127.0.0.1:1234/v1',
      requiresApiKey: false,
      supportsOptionalApiKey: true,
    });
  });

  it('starts with an empty built-in model catalog', () => {
    expect(getProvider('lmstudio')?.models).toEqual([]);
  });
});
