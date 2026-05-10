import { beforeEach, describe, expect, it, vi } from 'vitest';

const openAIChatMock = vi.fn((modelId: string) => `openai:${modelId}`);

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(() => ({
    chat: openAIChatMock,
  })),
}));

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));

vi.mock('@ai-sdk/google', () => ({
  createGoogleGenerativeAI: vi.fn(() => ({
    chat: vi.fn(),
  })),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

describe('grok model aliases', () => {
  beforeEach(() => {
    vi.resetModules();
    openAIChatMock.mockClear();
  });

  it('maps legacy Grok model ids to the current xAI aliases when building models', async () => {
    const { getModel } = await import('@/lib/ai/providers');
    const result = getModel({
      providerId: 'grok',
      modelId: 'grok-4.20-beta-0309-reasoning',
      apiKey: 'test-key',
      providerType: 'openai',
    });

    expect(openAIChatMock).toHaveBeenCalledWith('grok-4.20-0309-reasoning');
    expect(result.model).toBe('openai:grok-4.20-0309-reasoning');
  });

  it('returns current registry metadata for older saved Grok ids', async () => {
    const { getModelInfo } = await import('@/lib/ai/providers');
    const modelInfo = getModelInfo('grok', 'grok-4.20-beta-0309-reasoning');

    expect(modelInfo?.id).toBe('grok-4.20-0309-reasoning');
    expect(modelInfo?.name).toBe('Grok 4.20 Reasoning');
  });
});
