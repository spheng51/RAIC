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

  it('surfaces browser permission guidance when local-network access is still pending', () => {
    expect(
      getBrowserLocalFetchFailureMessage('LM Studio', {
        permissionState: 'prompt',
        targetAddressSpace: 'loopback',
      }),
    ).toContain('Allow local-network access for this site');
  });

  it('surfaces browser CORS guidance after permission has been granted', () => {
    expect(
      getBrowserLocalFetchFailureMessage('LM Studio', {
        permissionState: 'granted',
        targetAddressSpace: 'loopback',
      }),
    ).toContain('allows browser CORS access from this site');
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

  it('normalizes bare LM Studio root URLs before browser-local verification', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await verifyBrowserLocalOpenAIModel({
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen/test',
      baseUrl: 'http://127.0.0.1:1234',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:1234/v1/chat/completions');
  });

  it('uses loopback targetAddressSpace for localhost endpoints', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await verifyBrowserLocalOpenAIModel({
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen/test',
      baseUrl: 'http://127.0.0.1:1234/v1',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(requestInit).toMatchObject({
      targetAddressSpace: 'loopback',
    });
  });

  it('uses local targetAddressSpace for private-network endpoints', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await verifyBrowserLocalOpenAIModel({
      providerId: 'ollama',
      providerName: 'Ollama',
      modelId: 'llama3.1',
      baseUrl: 'http://192.168.1.25:11434/v1',
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(requestInit).toMatchObject({
      targetAddressSpace: 'local',
    });
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

  it('normalizes bare Ollama root URLs before browser-local streaming', async () => {
    const fetchMock = vi.fn(async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await streamBrowserLocalOpenAIChat({
      providerId: 'ollama',
      providerName: 'Ollama',
      modelId: 'llama3.1',
      baseUrl: 'http://localhost:11434',
      messages: [{ role: 'user', content: 'Say hello' }],
      onTextDelta() {},
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://localhost:11434/v1/chat/completions');
  });

  it('uses loopback targetAddressSpace for browser-local streaming to localhost', async () => {
    const fetchMock = vi.fn(async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            encoder.encode('data: {"choices":[{"delta":{"content":"OK"}}]}\n\ndata: [DONE]\n\n'),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      });
    });
    vi.stubGlobal('fetch', fetchMock);

    await streamBrowserLocalOpenAIChat({
      providerId: 'lmstudio',
      providerName: 'LM Studio',
      modelId: 'qwen/test',
      baseUrl: 'http://localhost:1234/v1',
      messages: [{ role: 'user', content: 'Say hello' }],
      onTextDelta() {},
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [RequestInfo | URL, RequestInit];
    expect(requestInit).toMatchObject({
      targetAddressSpace: 'loopback',
    });
  });
});
