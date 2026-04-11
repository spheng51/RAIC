import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { NextRequest } from 'next/server';
import {
  ProxyMediaTooLargeError,
  getDeclaredContentLength,
  readProxyBodyWithinLimit,
} from '@/lib/server/proxy-media';

vi.mock('@/lib/server/ssrf-guard', () => ({
  validateUrlForSSRF: vi.fn().mockResolvedValue(null),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const mockFetch = vi.fn() as Mock;
vi.stubGlobal('fetch', mockFetch);

function createProxyRequest() {
  return new NextRequest('http://localhost/api/proxy-media', {
    method: 'POST',
    body: JSON.stringify({ url: 'https://cdn.example.com/image.png' }),
  });
}

function createChunkedStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    },
  });
}

describe('proxy-media helpers and route', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('parses declared content length when present', () => {
    expect(getDeclaredContentLength(new Headers({ 'content-length': '1234' }))).toBe(1234);
    expect(getDeclaredContentLength(new Headers())).toBeNull();
    expect(getDeclaredContentLength(new Headers({ 'content-length': 'nope' }))).toBeNull();
  });

  it('buffers small payloads successfully', async () => {
    const body = await readProxyBodyWithinLimit(createChunkedStream(['hello']), 10);
    expect(new TextDecoder().decode(body)).toBe('hello');
  });

  it('errors when a chunked payload exceeds the byte limit', async () => {
    await expect(readProxyBodyWithinLimit(createChunkedStream(['1234', '5678']), 6)).rejects.toThrow(
      ProxyMediaTooLargeError,
    );
  });

  it('returns 403 when upstream responds with a redirect', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 302,
      headers: new Headers({ location: 'https://evil.example.com/elsewhere' }),
      body: null,
    });

    const { POST } = await import('@/app/api/proxy-media/route');
    const response = await POST(createProxyRequest());
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.errorCode).toBe('REDIRECT_NOT_ALLOWED');
  });

  it('proxies small media and preserves content type', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
      }),
      body: createChunkedStream(['hello', ' world']),
    });

    const { POST } = await import('@/app/api/proxy-media/route');
    const response = await POST(createProxyRequest());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(response.headers.get('content-length')).toBe('11');
    await expect(response.text()).resolves.toBe('hello world');
  });

  it('returns 413 before reading when upstream content-length exceeds the limit', async () => {
    vi.stubEnv('PROXY_MEDIA_MAX_BYTES', '10');
    const getReader = vi.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': '11',
        'content-type': 'image/png',
      }),
      body: { getReader } as ReadableStream<Uint8Array>,
    });

    const { POST } = await import('@/app/api/proxy-media/route');
    const response = await POST(createProxyRequest());
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.errorCode).toBe('PAYLOAD_TOO_LARGE');
    expect(getReader).not.toHaveBeenCalled();
  });

  it('returns 413 when a chunked response exceeds the limit without content-length', async () => {
    vi.stubEnv('PROXY_MEDIA_MAX_BYTES', '6');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-type': 'image/png',
      }),
      body: createChunkedStream(['1234', '5678']),
    });

    const { POST } = await import('@/app/api/proxy-media/route');
    const response = await POST(createProxyRequest());
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.errorCode).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 413 when actual bytes exceed the limit despite a smaller content-length header', async () => {
    vi.stubEnv('PROXY_MEDIA_MAX_BYTES', '6');
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({
        'content-length': '4',
        'content-type': 'image/png',
      }),
      body: createChunkedStream(['1234', '5678']),
    });

    const { POST } = await import('@/app/api/proxy-media/route');
    const response = await POST(createProxyRequest());
    const json = await response.json();

    expect(response.status).toBe(413);
    expect(json.errorCode).toBe('PAYLOAD_TOO_LARGE');
  });

  it('returns 504 when the upstream request times out', async () => {
    vi.useFakeTimers();
    vi.stubEnv('PROXY_MEDIA_TIMEOUT_MS', '10');
    mockFetch.mockImplementation((_url, init) => {
      const signal = (init as RequestInit).signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason));
      });
    });

    const { POST } = await import('@/app/api/proxy-media/route');
    const responsePromise = POST(createProxyRequest());
    await vi.advanceTimersByTimeAsync(10);
    const response = await responsePromise;
    const json = await response.json();

    expect(response.status).toBe(504);
    expect(json.errorCode).toBe('UPSTREAM_TIMEOUT');
  });
});
