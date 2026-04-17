import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getBrowserLocalFetchFailureMessage,
  streamBrowserLocalOpenAIChat,
  verifyBrowserLocalOpenAIModel,
} from '@/lib/utils/browser-local-openai';

describe('browser-local openai transport helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns a browser-local fetch guidance message', () => {
    expect(getBrowserLocalFetchFailureMessage('LM Studio')).toContain(
      'could not reach local LM Studio',
    );
  });

  it('maps auth failures during browser-local verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: { message: 'bad token' } }), {
            status: 401,
            headers: { 'Content-Type': 'application/json' },
          }),
      ),
    );

    await expect(
      verifyBrowserLocalOpenAIModel({
        providerId: 'lmstudio',
        providerName: 'LM Studio',
        modelId: 'qwen/test',
        baseUrl: 'http://127.0.0.1:1234/v1',
        apiKey: 'token',
      }),
    ).rejects.toThrow('Authentication failed for LM Studio');
  });

  it('maps network failures during browser-local verification', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    await expect(
      verifyBrowserLocalOpenAIModel({
        providerId: 'ollama',
        providerName: 'Ollama',
        modelId: 'llama3.1',
        baseUrl: 'http://127.0.0.1:11434/v1',
      }),
    ).rejects.toThrow('could not reach local Ollama');
  });

  it('streams browser-local chat deltas from an OpenAI-compatible SSE response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(
              encoder.encode(
                'data: {"choices":[{"delta":{"content":"Hello"}}]}\n\n' +
                  'data: {"choices":[{"delta":{"content":" world"}}]}\n\n' +
                  'data: [DONE]\n\n',
              ),
            );
            controller.close();
          },
        });

        return new Response(stream, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        });
      }),
    );

    const chunks: string[] = [];
    const result = await streamBrowserLocalOpenAIChat({
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen/test',
      baseUrl: 'http://127.0.0.1:1234/v1',
      messages: [{ role: 'user', content: 'Say hello' }],
      onTextDelta(delta) {
        chunks.push(delta);
      },
    });

    expect(result.hadContent).toBe(true);
    expect(chunks.join('')).toBe('Hello world');
  });
});
