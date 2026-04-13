import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const buildSearchQueryMock = vi.fn();
const formatSearchResultsAsContextMock = vi.fn();
const generateTextMock = vi.fn();
const getRequestAuthMock = vi.fn();
const getServerASRProvidersMock = vi.fn();
const getServerImageProvidersMock = vi.fn();
const getServerPDFProvidersMock = vi.fn();
const getServerProvidersMock = vi.fn();
const getServerTTSProvidersMock = vi.fn();
const getServerVideoProvidersMock = vi.fn();
const getServerWebSearchProvidersMock = vi.fn();
const resolveGovernedProviderConfigMock = vi.fn();
const resolveModelFromHeadersMock = vi.fn();
const resolveModelMock = vi.fn();
const searchWithTavilyMock = vi.fn();
const testImageConnectivityMock = vi.fn();
const testVideoConnectivityMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const validateUrlForSSRFMock = vi.fn();
const fetchMock = vi.fn();

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/media/image-providers', () => ({
  testImageConnectivity: testImageConnectivityMock,
}));

vi.mock('@/lib/media/video-providers', () => ({
  testVideoConnectivity: testVideoConnectivityMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  resolveGovernedProviderConfig: resolveGovernedProviderConfigMock,
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
}));

vi.mock('@/lib/server/provider-config', () => ({
  getServerASRProviders: getServerASRProvidersMock,
  getServerImageProviders: getServerImageProvidersMock,
  getServerPDFProviders: getServerPDFProvidersMock,
  getServerProviders: getServerProvidersMock,
  getServerTTSProviders: getServerTTSProvidersMock,
  getServerVideoProviders: getServerVideoProvidersMock,
  getServerWebSearchProviders: getServerWebSearchProvidersMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: resolveModelMock,
  resolveModelFromHeaders: resolveModelFromHeadersMock,
}));

vi.mock('@/lib/server/search-query-builder', () => ({
  buildSearchQuery: buildSearchQueryMock,
  SEARCH_QUERY_REWRITE_EXCERPT_LENGTH: 4096,
}));

vi.mock('@/lib/server/ssrf-guard', () => ({
  validateUrlForSSRF: validateUrlForSSRFMock,
}));

vi.mock('@/lib/web-search/tavily', () => ({
  formatSearchResultsAsContext: formatSearchResultsAsContextMock,
  searchWithTavily: searchWithTavilyMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const authContext = {
  organization: { id: 'org-1' },
  session: { role: 'teacher' },
  user: { id: 'teacher-1' },
};

describe('provider and verification routes', () => {
  beforeEach(() => {
    vi.resetModules();
    buildSearchQueryMock.mockReset();
    formatSearchResultsAsContextMock.mockReset();
    generateTextMock.mockReset();
    getRequestAuthMock.mockReset();
    getServerASRProvidersMock.mockReset();
    getServerImageProvidersMock.mockReset();
    getServerPDFProvidersMock.mockReset();
    getServerProvidersMock.mockReset();
    getServerTTSProvidersMock.mockReset();
    getServerVideoProvidersMock.mockReset();
    getServerWebSearchProvidersMock.mockReset();
    resolveGovernedProviderConfigMock.mockReset();
    resolveModelFromHeadersMock.mockReset();
    resolveModelMock.mockReset();
    searchWithTavilyMock.mockReset();
    testImageConnectivityMock.mockReset();
    testVideoConnectivityMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReset();
    validateUrlForSSRFMock.mockReset();
    fetchMock.mockReset();

    getRequestAuthMock.mockResolvedValue(authContext);
    getServerASRProvidersMock.mockReturnValue({});
    getServerImageProvidersMock.mockReturnValue({});
    getServerPDFProvidersMock.mockReturnValue({});
    getServerProvidersMock.mockReturnValue({});
    getServerTTSProvidersMock.mockReturnValue({});
    getServerVideoProvidersMock.mockReturnValue({});
    getServerWebSearchProvidersMock.mockReturnValue({});
    resolveGovernedProviderConfigMock.mockResolvedValue({
      apiKey: 'server-key',
      baseUrl: 'https://provider.example.com',
      modelId: 'provider-model',
    });
    resolveModelFromHeadersMock.mockResolvedValue({ model: 'resolved-model' });
    resolveModelMock.mockResolvedValue({ model: 'resolved-model' });
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
    validateUrlForSSRFMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('returns all configured server-side providers', async () => {
    getServerProvidersMock.mockReturnValue({ openai: { models: ['gpt-4o'] } });
    getServerImageProvidersMock.mockReturnValue({ seedream: { models: ['seedream-model'] } });

    const { GET } = await import('@/app/api/server-providers/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.providers).toEqual({ openai: { models: ['gpt-4o'] } });
    expect(body.image).toEqual({ seedream: { models: ['seedream-model'] } });
  });

  it('surfaces server-provider lookup failures as internal errors', async () => {
    getServerProvidersMock.mockImplementation(() => {
      throw new Error('provider lookup failed');
    });

    const { GET } = await import('@/app/api/server-providers/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.errorCode).toBe('INTERNAL_ERROR');
  });

  it('rejects image-provider verification when no API key is available', async () => {
    resolveGovernedProviderConfigMock.mockResolvedValue({
      apiKey: '',
      baseUrl: 'https://images.example.com',
      modelId: 'seedream-model',
    });

    const { POST } = await import('@/app/api/verify-image-provider/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-image-provider', {
        method: 'POST',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
  });

  it('verifies image-provider connectivity with resolved credentials', async () => {
    testImageConnectivityMock.mockResolvedValue({
      success: true,
      message: 'Connection successful',
    });

    const { POST } = await import('@/app/api/verify-image-provider/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-image-provider', {
        method: 'POST',
        headers: {
          'x-image-provider': 'seedream',
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
    });
  });

  it('requires a model name before verifying model connectivity', async () => {
    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('verifies that a model can answer a minimal prompt', async () => {
    generateTextMock.mockResolvedValue({ text: 'OK' });

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({
          model: 'openai:gpt-4o',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
      response: 'OK',
    });
  });

  it('requires a provider id before verifying PDF connectivity', async () => {
    const { POST } = await import('@/app/api/verify-pdf-provider/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-pdf-provider', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('accepts reachable PDF servers even when they return 404 at the root', async () => {
    fetchMock.mockResolvedValue(new Response('not found', { status: 404 }));

    const { POST } = await import('@/app/api/verify-pdf-provider/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-pdf-provider', {
        method: 'POST',
        body: JSON.stringify({
          providerId: 'mineru',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
      status: 404,
    });
  });

  it('rejects video-provider verification when no API key is available', async () => {
    resolveGovernedProviderConfigMock.mockResolvedValue({
      apiKey: '',
      baseUrl: 'https://video.example.com',
      modelId: 'seedance-model',
    });

    const { POST } = await import('@/app/api/verify-video-provider/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-video-provider', {
        method: 'POST',
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
  });

  it('verifies video-provider connectivity with resolved credentials', async () => {
    testVideoConnectivityMock.mockResolvedValue({
      success: true,
      message: 'Connection successful',
    });

    const { POST } = await import('@/app/api/verify-video-provider/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-video-provider', {
        method: 'POST',
        headers: {
          'x-video-provider': 'seedance',
        },
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
    });
  });

  it('requires a query before running web search', async () => {
    const { POST } = await import('@/app/api/web-search/route');
    const response = await POST(
      new NextRequest('http://localhost/api/web-search', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('returns web-search results and formatted context', async () => {
    buildSearchQueryMock.mockResolvedValue({
      query: 'renewable energy',
      hasPdfContext: false,
      rawRequirementLength: 16,
      rewriteAttempted: true,
      finalQueryLength: 16,
    });
    searchWithTavilyMock.mockResolvedValue({
      answer: 'Search answer',
      query: 'renewable energy',
      responseTime: 123,
      sources: [{ title: 'Source', url: 'https://example.com' }],
    });
    formatSearchResultsAsContextMock.mockReturnValue('formatted context');

    const { POST } = await import('@/app/api/web-search/route');
    const response = await POST(
      new NextRequest('http://localhost/api/web-search', {
        method: 'POST',
        body: JSON.stringify({
          query: 'renewable energy',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      answer: 'Search answer',
      context: 'formatted context',
      query: 'renewable energy',
      responseTime: 123,
      sources: [{ title: 'Source', url: 'https://example.com' }],
    });
  });
});
