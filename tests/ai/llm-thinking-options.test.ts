import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMock = vi.hoisted(() => ({
  generateText: vi.fn(async (params: unknown) => ({ text: 'ok', params })),
  streamText: vi.fn(),
}));

const runMock = vi.hoisted(() =>
  vi.fn((_thinking: unknown, callback: () => unknown) => callback()),
);

vi.mock('ai', () => ({
  generateText: aiMock.generateText,
  streamText: aiMock.streamText,
}));

vi.mock('@/lib/ai/thinking-context', () => ({
  thinkingContext: {
    run: runMock,
  },
}));

describe('LLM thinking provider options', () => {
  beforeEach(() => {
    aiMock.generateText.mockClear();
    runMock.mockClear();
  });

  it('sends Claude Haiku thinking budget without effort', async () => {
    const { callLLM } = await import('@/lib/ai/llm');

    await callLLM(
      {
        model: {
          provider: 'anthropic.messages',
          modelId: 'claude-haiku-4-5',
        },
        prompt: 'hi',
      } as Parameters<typeof callLLM>[0],
      'test',
      undefined,
      { mode: 'enabled', budgetTokens: 4096 },
    );

    expect(aiMock.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          anthropic: {
            thinking: { type: 'enabled', budgetTokens: 4096 },
          },
        },
      }),
    );
    const params = aiMock.generateText.mock.calls[0]?.[0] as {
      providerOptions?: { anthropic?: Record<string, unknown> };
    };
    expect(params.providerOptions?.anthropic).not.toHaveProperty('effort');
  });

  it('passes OpenAI effort options through providerOptions', async () => {
    const { callLLM } = await import('@/lib/ai/llm');

    await callLLM(
      {
        model: {
          provider: 'openai.chat',
          modelId: 'gpt-5.4',
        },
        prompt: 'hi',
      } as Parameters<typeof callLLM>[0],
      'test',
      undefined,
      { effort: 'high' },
    );

    expect(aiMock.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        providerOptions: {
          openai: {
            reasoningEffort: 'high',
          },
        },
      }),
    );
  });
});
