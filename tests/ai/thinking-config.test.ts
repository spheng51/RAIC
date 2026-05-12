import { describe, expect, it } from 'vitest';

import { getProvider } from '@/lib/ai/providers';
import {
  getDefaultThinkingConfig,
  getThinkingDisplayValue,
  normalizeThinkingConfig,
  supportsConfigurableThinking,
} from '@/lib/ai/thinking-config';
import type { ProviderId } from '@/lib/types/provider';

function getThinking(providerId: ProviderId, modelId: string) {
  return getProvider(providerId)?.models.find((item) => item.id === modelId)?.capabilities
    ?.thinking;
}

describe('thinking config metadata', () => {
  it('annotates legacy Qwen thinking metadata with adapter controls', () => {
    const thinking = getThinking('qwen', 'qwen3.6-plus');

    expect(supportsConfigurableThinking(thinking)).toBe(true);
    expect(thinking?.control).toBe('toggle-budget');
    expect(thinking?.requestAdapter).toBe('qwen');
  });

  it('exposes OpenRouter reasoning effort metadata', () => {
    const thinking = getThinking('openrouter', 'openai/gpt-5.1');

    expect(supportsConfigurableThinking(thinking)).toBe(true);
    expect(thinking?.control).toBe('effort');
    expect(thinking?.requestAdapter).toBe('openrouter');
    expect(normalizeThinkingConfig(thinking, { effort: 'high' })).toEqual({
      mode: 'enabled',
      effort: 'high',
    });
  });

  it('normalizes Lemonade token-budget thinking controls', () => {
    const thinking = getThinking('lemonade', 'Qwen3.5-4B-GGUF');

    expect(supportsConfigurableThinking(thinking)).toBe(true);
    expect(thinking?.requestAdapter).toBe('lemonade');
    expect(getDefaultThinkingConfig(thinking)).toEqual({
      mode: 'enabled',
      budgetTokens: 1024,
    });
    expect(normalizeThinkingConfig(thinking, { mode: 'enabled', budgetTokens: 4096 })).toEqual({
      mode: 'enabled',
      budgetTokens: 4096,
    });
  });

  it('preserves dynamic Gemini budget display labels', () => {
    const thinking = getThinking('google', 'gemini-2.5-flash');

    expect(getThinkingDisplayValue(thinking, undefined)).toBe('auto');
  });
});
