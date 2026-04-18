import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const buildSearchQueryMock = vi.fn();
const appendAuditLogMock = vi.fn();
const formatSearchResultsAsContextMock = vi.fn();
const generateTextMock = vi.fn();
const getProviderScenarioProfileMock = vi.fn();
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

class MockGovernedProviderResolutionError extends Error {
  readonly code: string;
  readonly status: number;
  readonly apiErrorCode: string;

  constructor(
    code: string,
    message: string,
    options: {
      status: number;
      apiErrorCode: string;
    },
  ) {
    super(message);
    this.name = 'GovernedProviderResolutionError';
    this.code = code;
    this.status = options.status;
    this.apiErrorCode = options.apiErrorCode;
  }
}

vi.mock('ai', () => ({
  generateText: generateTextMock,
}));

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/db/repositories/audit-logs', () => ({
  appendAuditLog: appendAuditLogMock,
}));

vi.mock('@/lib/media/image-providers', () => ({
  IMAGE_PROVIDERS: {
    seedream: {
      id: 'seedream',
      name: 'Seedream',
      requiresApiKey: true,
      models: [
        { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite' },
        { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' },
      ],
      supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
    },
  },
  testImageConnectivity: testImageConnectivityMock,
}));

vi.mock('@/lib/media/video-providers', () => ({
  VIDEO_PROVIDERS: {
    seedance: {
      id: 'seedance',
      name: 'Seedance',
      requiresApiKey: true,
      models: [
        { id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' },
        { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro' },
      ],
      supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
    },
  },
  testVideoConnectivity: testVideoConnectivityMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  GovernedProviderResolutionError: MockGovernedProviderResolutionError,
  isGovernedProviderResolutionError: (error: unknown) =>
    error instanceof MockGovernedProviderResolutionError,
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

vi.mock('@/lib/server/provider-scenarios', () => ({
  getProviderScenarioProfile: getProviderScenarioProfileMock,
}));

const authContext = {
  organization: { id: 'org-1' },
  session: { role: 'teacher' },
  user: { id: 'teacher-1' },
};

describe('provider and verification routes', () => {
  beforeEach(() => {
    vi.resetModules();
    appendAuditLogMock.mockReset();
    buildSearchQueryMock.mockReset();
    formatSearchResultsAsContextMock.mockReset();
    generateTextMock.mockReset();
    getProviderScenarioProfileMock.mockReset();
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
    appendAuditLogMock.mockResolvedValue({
      id: 'audit-1',
      action: 'provider_scenario.route_selected',
      createdAt: new Date().toISOString(),
      metadata: {},
    });
    getProviderScenarioProfileMock.mockReturnValue(null);
    resolveGovernedProviderConfigMock.mockImplementation(
      async ({ providerId, requestedModel }: { providerId: string; requestedModel?: string }) => ({
        providerId,
        apiKey: 'server-key',
        baseUrl: 'https://provider.example.com',
        modelId: requestedModel || 'provider-model',
      }),
    );
    resolveModelFromHeadersMock.mockResolvedValue({ model: 'resolved-model' });
    resolveModelMock.mockResolvedValue({
      model: 'resolved-model',
      modelInfo: {
        id: 'gpt-4o',
        name: 'GPT-4o',
        capabilities: {
          streaming: true,
          tools: true,
        },
      },
      modelString: 'openai:gpt-4o',
      providerId: 'openai',
      apiKey: 'server-key',
    });
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

  it('uses scenario-managed verification for matching model candidates and emits audit telemetry', async () => {
    generateTextMock.mockResolvedValue({ text: 'OK' });
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed verification.',
      buckets: {
        scene: [
          { providerId: 'openai', modelId: 'gpt-4o' },
          { providerId: 'openai', modelId: 'gpt-4o-mini' },
        ],
      },
    });

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
    expect(resolveModelMock).toHaveBeenCalledWith({
      modelString: 'openai:gpt-4o',
      apiKey: '',
      baseUrl: undefined,
      providerType: undefined,
      auth: authContext,
    });
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'verify-model',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'scene',
          routeId: 'verify-model',
          selectedProviderId: 'openai',
          selectedModelId: 'gpt-4o',
          fallbackProviderId: null,
          fallbackModelId: null,
          validationStatus: 'selected',
        }),
      }),
    );
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
      response: 'OK',
    });
  });

  it('verifies LM Studio models without requiring an API key', async () => {
    generateTextMock.mockResolvedValue({ text: 'OK' });
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed verification.',
      buckets: {
        scene: [{ providerId: 'openai', modelId: 'gpt-4o' }],
      },
    });

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({
          model: 'lmstudio:qwen3.5-4b',
          providerType: 'openai',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveModelMock).toHaveBeenCalledWith({
      modelString: 'lmstudio:qwen3.5-4b',
      apiKey: '',
      baseUrl: undefined,
      providerType: 'openai',
      auth: authContext,
    });
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
      response: 'OK',
    });
    expect(appendAuditLogMock).not.toHaveBeenCalled();
  });

  it('includes the tested model id in verification failures', async () => {
    resolveModelMock.mockResolvedValue({
      model: 'resolved-model',
      modelString: 'grok:grok-4.20-reasoning',
    });
    generateTextMock.mockRejectedValue(new Error('403 forbidden'));

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('http://localhost/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({
          model: 'grok:grok-4.20-reasoning',
          providerType: 'openai',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain('grok:grok-4.20-reasoning');
  });

  it('remaps LM Studio local/private SSRF failures to a topology message', async () => {
    resolveModelMock.mockRejectedValue(new Error('Local/private network URLs are not allowed'));

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('https://open-raic.com/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({
          model: 'lmstudio:qwen3.5-4b',
          baseUrl: 'http://127.0.0.1:1234/v1',
          providerType: 'openai',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.error).toContain('Hosted Open-RAIC cannot reach your local LM Studio server');
    expect(body.error).not.toContain('Local/private network URLs are not allowed');
  });

  it('remaps Ollama localhost connection failures to a private-deployment guidance message', async () => {
    resolveModelMock.mockResolvedValue({
      model: 'resolved-model',
      modelString: 'ollama:llama3.3',
    });
    generateTextMock.mockRejectedValue(new Error('connect ECONNREFUSED 127.0.0.1:11434'));

    const { POST } = await import('@/app/api/verify-model/route');
    const response = await POST(
      new NextRequest('http://localhost:3000/api/verify-model', {
        method: 'POST',
        body: JSON.stringify({
          model: 'ollama:llama3.3',
          providerType: 'openai',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body.error).toContain(
      'Open-RAIC cannot use a browser-supplied localhost/private address for Ollama',
    );
    expect(body.error).toContain('ALLOW_LOCAL_NETWORKS=true');
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

  it('falls back to the next scenario-managed image candidate and records fallback telemetry', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed verification.',
      buckets: {
        image: [
          { providerId: 'seedream', modelId: 'doubao-seedream-5-0-260128' },
          { providerId: 'seedream', modelId: 'doubao-seedream-4-5-251128' },
        ],
      },
    });
    resolveGovernedProviderConfigMock
      .mockRejectedValueOnce(
        new MockGovernedProviderResolutionError(
          'MISSING_PROVIDER_CREDENTIALS',
          'No API key configured for provider "seedream".',
          {
            status: 400,
            apiErrorCode: 'MISSING_API_KEY',
          },
        ),
      )
      .mockResolvedValueOnce({
        providerId: 'seedream',
        apiKey: 'fallback-key',
        baseUrl: 'https://images.example.com',
        modelId: 'doubao-seedream-4-5-251128',
      });
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
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'image',
        providerId: 'seedream',
        requestedModel: 'doubao-seedream-5-0-260128',
      }),
    );
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        family: 'image',
        providerId: 'seedream',
        requestedModel: 'doubao-seedream-4-5-251128',
      }),
    );
    expect(testImageConnectivityMock).toHaveBeenCalledWith({
      providerId: 'seedream',
      apiKey: 'fallback-key',
      baseUrl: 'https://images.example.com',
      model: 'doubao-seedream-4-5-251128',
    });
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'verify-image-provider',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'image',
          routeId: 'verify-image-provider',
          selectedProviderId: 'seedream',
          selectedModelId: 'doubao-seedream-4-5-251128',
          fallbackProviderId: 'seedream',
          fallbackModelId: 'doubao-seedream-4-5-251128',
          validationStatus: 'fallback_selected',
          fallbackReason: expect.stringContaining('doubao-seedream-5-0-260128'),
        }),
      }),
    );
    expect(body).toEqual({
      success: true,
      message: 'Connection successful',
    });
  });

  it('fails closed for scenario-managed video verification when no validated candidate remains', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed verification.',
      buckets: {
        video: [{ providerId: 'seedance', modelId: 'doubao-seedance-1-5-pro-251215' }],
      },
    });
    const missingCredentialsError = new MockGovernedProviderResolutionError(
      'MISSING_PROVIDER_CREDENTIALS',
      'No API key configured for provider "seedance".',
      {
        status: 400,
        apiErrorCode: 'MISSING_API_KEY',
      },
    );
    resolveGovernedProviderConfigMock.mockRejectedValue(missingCredentialsError);
    toGovernedProviderApiErrorResponseMock.mockImplementation((error) =>
      error === missingCredentialsError
        ? new Response(
            JSON.stringify({
              success: false,
              errorCode: 'MISSING_API_KEY',
              error: missingCredentialsError.message,
            }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        : null,
    );

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

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
    expect(testVideoConnectivityMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_denied',
        resourceType: 'provider_scenario',
        resourceId: 'verify-video-provider',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'video',
          routeId: 'verify-video-provider',
          selectedProviderId: null,
          selectedModelId: null,
          validationStatus: 'failed_closed',
          fallbackReason: expect.stringContaining('doubao-seedance-1-5-pro-251215'),
        }),
      }),
    );
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

  it('routes web search through the scenario-managed provider and emits audit telemetry', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        webSearch: [{ providerId: 'tavily' }],
      },
    });
    buildSearchQueryMock.mockResolvedValue({
      query: 'renewable energy',
      hasPdfContext: false,
      rawRequirementLength: 16,
      rewriteAttempted: false,
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
    expect(resolveGovernedProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        family: 'webSearch',
        providerId: 'tavily',
      }),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'web-search',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'webSearch',
          routeId: 'web-search',
          selectedProviderId: 'tavily',
          selectedModelId: null,
          validationStatus: 'selected',
          requestedProviderId: 'tavily',
          requestedModelId: null,
        }),
      }),
    );
    expect(body).toEqual({
      success: true,
      answer: 'Search answer',
      context: 'formatted context',
      query: 'renewable energy',
      responseTime: 123,
      sources: [{ title: 'Source', url: 'https://example.com' }],
    });
  });

  it('fails closed for scenario-managed web search when no validated candidate remains', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        webSearch: [{ providerId: 'tavily' }],
      },
    });
    const missingCredentialsError = new MockGovernedProviderResolutionError(
      'MISSING_PROVIDER_CREDENTIALS',
      'No API key configured for provider "tavily".',
      {
        status: 400,
        apiErrorCode: 'MISSING_API_KEY',
      },
    );
    resolveGovernedProviderConfigMock.mockRejectedValue(missingCredentialsError);
    toGovernedProviderApiErrorResponseMock.mockImplementation((error) =>
      error === missingCredentialsError
        ? new Response(
            JSON.stringify({
              success: false,
              errorCode: 'MISSING_API_KEY',
              error: missingCredentialsError.message,
            }),
            {
              status: 400,
              headers: {
                'Content-Type': 'application/json',
              },
            },
          )
        : null,
    );

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

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
    expect(searchWithTavilyMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_denied',
        resourceType: 'provider_scenario',
        resourceId: 'web-search',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'webSearch',
          routeId: 'web-search',
          selectedProviderId: null,
          selectedModelId: null,
          validationStatus: 'failed_closed',
          fallbackReason: expect.stringContaining('tavily'),
        }),
      }),
    );
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
