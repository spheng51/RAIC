import { describe, expect, it } from 'vitest';
import { MODEL_REGISTRY_CHECKED_AT, PROVIDERS } from '@/lib/ai/providers';

describe('OpenAI built-in catalog', () => {
  it('surfaces the current curated OpenAI LLM list in the expected order', () => {
    const modelIds = PROVIDERS.openai.models.map((model) => model.id);

    expect(MODEL_REGISTRY_CHECKED_AT).toBe('2026-05-10');
    expect(modelIds).toEqual([
      'gpt-5.5',
      'gpt-5.4',
      'gpt-5.4-mini',
      'gpt-5.4-nano',
      'gpt-5.2',
      'gpt-5.1',
      'gpt-5',
      'gpt-5-mini',
      'gpt-5-nano',
      'gpt-4.1',
      'gpt-4.1-mini',
      'gpt-4.1-nano',
      'o4-mini',
      'o3',
      'o3-mini',
      'o1',
      'gpt-4o',
      'gpt-4o-mini',
      'gpt-4-turbo',
    ]);
  });

  it('includes current metadata for the newly added OpenAI models', () => {
    const gpt55 = PROVIDERS.openai.models.find((model) => model.id === 'gpt-5.5');
    const gpt41 = PROVIDERS.openai.models.find((model) => model.id === 'gpt-4.1');

    expect(gpt55).toMatchObject({
      contextWindow: 1000000,
      outputWindow: 128000,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
        thinking: {
          toggleable: true,
          budgetAdjustable: true,
          defaultEnabled: false,
        },
      },
    });

    expect(gpt41).toMatchObject({
      contextWindow: 1047576,
      outputWindow: 32768,
      capabilities: {
        streaming: true,
        tools: true,
        vision: true,
      },
    });
  });
});
