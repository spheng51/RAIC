import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateTextMock = vi.fn();
const streamTextMock = vi.fn();
const warnMock = vi.fn();
const runMock = vi.fn((_thinking: unknown, callback: () => unknown) => callback());

vi.mock('ai', () => ({
  generateText: generateTextMock,
  streamText: streamTextMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock('@/lib/ai/providers', () => ({
  PROVIDERS: {},
}));

vi.mock('@/lib/ai/thinking-context', () => ({
  thinkingContext: {
    run: runMock,
  },
}));

describe('streamLLM', () => {
  beforeEach(() => {
    vi.resetModules();
    generateTextMock.mockReset();
    streamTextMock.mockReset();
    warnMock.mockReset();
    runMock.mockClear();
    runMock.mockImplementation((_thinking: unknown, callback: () => unknown) => callback());
  });

  it('logs stream errors through the structured logger and preserves caller hooks', async () => {
    const resultValue = { textStream: [] };
    const callerOnError = vi.fn();
    streamTextMock.mockReturnValue(resultValue);

    const { streamLLM } = await import('@/lib/ai/llm');

    const result = streamLLM(
      {
        model: 'test-model',
        prompt: 'hello',
        onError: callerOnError,
      } as never,
      'scene-outlines-stream',
    );

    expect(result).toBe(resultValue);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(streamTextMock).toHaveBeenCalledTimes(1);

    const streamParams = streamTextMock.mock.calls[0]?.[0] as {
      onError?: (event: { error: unknown }) => Promise<void>;
    };
    expect(streamParams.onError).toEqual(expect.any(Function));

    const error = Object.assign(new Error('invalid api key'), {
      statusCode: 401,
      apiKey: 'secret',
    });

    await streamParams.onError?.({ error });

    expect(warnMock).toHaveBeenCalledWith('[scene-outlines-stream] Stream failed', error);
    expect(callerOnError).toHaveBeenCalledWith({ error });
  });
});
