import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const aspectRatioToDimensionsMock = vi.fn();
const appendAuditLogMock = vi.fn();
const generateImageMock = vi.fn();
const generateTTSMock = vi.fn();
const generateVideoMock = vi.fn();
const getProviderScenarioProfileMock = vi.fn();
const getRequestAuthMock = vi.fn();
const normalizeVideoOptionsMock = vi.fn();
const parsePDFMock = vi.fn();
const resolveGovernedProviderConfigMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const transcribeAudioMock = vi.fn();
const validateUrlForSSRFMock = vi.fn();

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

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/db/repositories/audit-logs', () => ({
  appendAuditLog: appendAuditLogMock,
}));

vi.mock('@/lib/audio/asr-providers', () => ({
  transcribeAudio: transcribeAudioMock,
}));

vi.mock('@/lib/audio/tts-providers', () => ({
  generateTTS: generateTTSMock,
}));

vi.mock('@/lib/media/image-providers', () => ({
  IMAGE_PROVIDERS: {
    seedream: {
      id: 'seedream',
      name: 'Seedream',
      requiresApiKey: true,
      defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
      models: [
        { id: 'doubao-seedream-5-0-260128', name: 'Seedream 5.0 Lite' },
        { id: 'doubao-seedream-4-5-251128', name: 'Seedream 4.5' },
      ],
      supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
    },
    'qwen-image': {
      id: 'qwen-image',
      name: 'Qwen Image',
      requiresApiKey: true,
      defaultBaseUrl: 'https://dashscope.aliyuncs.com',
      models: [{ id: 'qwen-image-max', name: 'Qwen Image Max' }],
      supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16'],
    },
    'nano-banana': {
      id: 'nano-banana',
      name: 'Nano Banana',
      requiresApiKey: true,
      defaultBaseUrl: 'https://generativelanguage.googleapis.com',
      models: [
        {
          id: 'gemini-3.1-flash-image-preview',
          name: 'Gemini 3.1 Flash Image',
        },
      ],
      supportedAspectRatios: ['16:9', '4:3', '1:1'],
    },
  },
  aspectRatioToDimensions: aspectRatioToDimensionsMock,
  generateImage: generateImageMock,
}));

vi.mock('@/lib/media/video-providers', () => ({
  VIDEO_PROVIDERS: {
    seedance: {
      id: 'seedance',
      name: 'Seedance',
      requiresApiKey: true,
      defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
      models: [{ id: 'doubao-seedance-1-5-pro-251215', name: 'Seedance 1.5 Pro' }],
      supportedAspectRatios: ['16:9', '4:3', '1:1', '9:16', '3:4', '21:9'],
      supportedDurations: [5, 10],
      supportedResolutions: ['480p', '720p', '1080p'],
      maxDuration: 10,
    },
    kling: {
      id: 'kling',
      name: 'Kling',
      requiresApiKey: true,
      defaultBaseUrl: 'https://api-beijing.klingai.com',
      models: [{ id: 'kling-v2-6', name: 'Kling V2.6' }],
      supportedAspectRatios: ['16:9', '1:1', '9:16'],
      supportedDurations: [5, 10],
    },
    veo: {
      id: 'veo',
      name: 'Veo',
      requiresApiKey: true,
      defaultBaseUrl: 'https://generativelanguage.googleapis.com',
      models: [{ id: 'veo-3.1-fast-generate-001', name: 'Veo 3.1 Fast' }],
      supportedAspectRatios: ['16:9', '1:1', '9:16'],
      supportedDurations: [8],
      supportedResolutions: ['720p'],
      maxDuration: 8,
    },
  },
  generateVideo: generateVideoMock,
  normalizeVideoOptions: normalizeVideoOptionsMock,
}));

vi.mock('@/lib/pdf/pdf-providers', () => ({
  parsePDF: parsePDFMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  GovernedProviderResolutionError: MockGovernedProviderResolutionError,
  isGovernedProviderResolutionError: (error: unknown) =>
    error instanceof MockGovernedProviderResolutionError,
  resolveGovernedProviderConfig: resolveGovernedProviderConfigMock,
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
}));

vi.mock('@/lib/server/provider-scenarios', () => ({
  getProviderScenarioProfile: getProviderScenarioProfileMock,
}));

vi.mock('@/lib/server/ssrf-guard', () => ({
  validateUrlForSSRF: validateUrlForSSRFMock,
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

describe('media generation routes', () => {
  beforeEach(() => {
    vi.resetModules();
    aspectRatioToDimensionsMock.mockReset();
    appendAuditLogMock.mockReset();
    generateImageMock.mockReset();
    generateTTSMock.mockReset();
    generateVideoMock.mockReset();
    getProviderScenarioProfileMock.mockReset();
    getRequestAuthMock.mockReset();
    normalizeVideoOptionsMock.mockReset();
    parsePDFMock.mockReset();
    resolveGovernedProviderConfigMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReset();
    transcribeAudioMock.mockReset();
    validateUrlForSSRFMock.mockReset();

    aspectRatioToDimensionsMock.mockReturnValue({ width: 1280, height: 720 });
    getRequestAuthMock.mockResolvedValue(authContext);
    normalizeVideoOptionsMock.mockImplementation((_providerId, options) => options);
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
    toGovernedProviderApiErrorResponseMock.mockImplementation((error) =>
      error instanceof MockGovernedProviderResolutionError
        ? new Response(
            JSON.stringify({
              success: false,
              errorCode: error.apiErrorCode,
              error: error.message,
            }),
            {
              status: error.status,
              headers: { 'Content-Type': 'application/json' },
            },
          )
        : null,
    );
    validateUrlForSSRFMock.mockResolvedValue(null);
  });

  it('rejects image-generation requests without a prompt', async () => {
    const { POST } = await import('@/app/api/generate/image/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/image', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('generates images with resolved provider config', async () => {
    generateImageMock.mockResolvedValue({ url: 'https://cdn.example.com/image.png' });

    const { POST } = await import('@/app/api/generate/image/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/image', {
        method: 'POST',
        headers: {
          'x-image-provider': 'seedream',
        },
        body: JSON.stringify({
          prompt: 'A solar-powered classroom',
          aspectRatio: '16:9',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      result: { url: 'https://cdn.example.com/image.png' },
    });
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'seedream',
        apiKey: 'server-key',
        baseUrl: 'https://provider.example.com',
        model: 'provider-model',
      }),
      expect.objectContaining({
        prompt: 'A solar-powered classroom',
        width: 1280,
        height: 720,
      }),
    );
  });

  it('routes image generation through the scenario bucket even when the request hints a different provider', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        image: [
          { providerId: 'seedream', modelId: 'doubao-seedream-5-0-260128' },
          { providerId: 'qwen-image', modelId: 'qwen-image-max' },
        ],
      },
    });
    generateImageMock.mockResolvedValue({ url: 'https://cdn.example.com/image.png' });

    const { POST } = await import('@/app/api/generate/image/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/image', {
        method: 'POST',
        headers: {
          'x-image-provider': 'qwen-image',
          'x-image-model': 'qwen-image-max',
        },
        body: JSON.stringify({
          prompt: 'A scenario-routed classroom poster',
          aspectRatio: '16:9',
        }),
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
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'seedream',
        model: 'doubao-seedream-5-0-260128',
      }),
      expect.objectContaining({
        prompt: 'A scenario-routed classroom poster',
        width: 1280,
        height: 720,
      }),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'generate-image',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'image',
          routeId: 'generate-image',
          selectedProviderId: 'seedream',
          selectedModelId: 'doubao-seedream-5-0-260128',
          validationStatus: 'selected',
          requestedProviderId: 'qwen-image',
          requestedModelId: 'qwen-image-max',
        }),
      }),
    );
    expect(body).toEqual({
      success: true,
      result: { url: 'https://cdn.example.com/image.png' },
    });
  });

  it('falls back to the next validated image scenario candidate when the first provider cannot satisfy the aspect ratio', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        image: [
          { providerId: 'nano-banana', modelId: 'gemini-3.1-flash-image-preview' },
          { providerId: 'seedream', modelId: 'doubao-seedream-5-0-260128' },
        ],
      },
    });
    generateImageMock.mockResolvedValue({ url: 'https://cdn.example.com/image.png' });

    const { POST } = await import('@/app/api/generate/image/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/image', {
        method: 'POST',
        headers: {
          'x-image-provider': 'nano-banana',
          'x-image-model': 'gemini-3.1-flash-image-preview',
        },
        body: JSON.stringify({
          prompt: 'A vertical lab poster',
          aspectRatio: '9:16',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'image',
        providerId: 'nano-banana',
        requestedModel: 'gemini-3.1-flash-image-preview',
      }),
    );
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        family: 'image',
        providerId: 'seedream',
        requestedModel: 'doubao-seedream-5-0-260128',
      }),
    );
    expect(generateImageMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'seedream',
        model: 'doubao-seedream-5-0-260128',
      }),
      expect.objectContaining({
        aspectRatio: '9:16',
      }),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'generate-image',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'image',
          routeId: 'generate-image',
          selectedProviderId: 'seedream',
          selectedModelId: 'doubao-seedream-5-0-260128',
          fallbackProviderId: 'seedream',
          fallbackModelId: 'doubao-seedream-5-0-260128',
          validationStatus: 'fallback_selected',
          requestedProviderId: 'nano-banana',
          requestedModelId: 'gemini-3.1-flash-image-preview',
          fallbackReason: expect.stringContaining('nano-banana:gemini-3.1-flash-image-preview'),
        }),
      }),
    );
    expect(body.success).toBe(true);
  });

  it('fails closed for scenario-managed image generation when every candidate is invalid', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        image: [{ providerId: 'seedream', modelId: 'doubao-seedream-5-0-260128' }],
      },
    });

    const { POST } = await import('@/app/api/generate/image/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/image', {
        method: 'POST',
        headers: {
          'x-image-provider': 'seedream',
        },
        body: JSON.stringify({
          prompt: 'A watercolor classroom mural',
          style: 'watercolor',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('INVALID_REQUEST');
    expect(generateImageMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_denied',
        resourceType: 'provider_scenario',
        resourceId: 'generate-image',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'image',
          routeId: 'generate-image',
          selectedProviderId: null,
          selectedModelId: null,
          validationStatus: 'failed_closed',
          fallbackReason: expect.stringContaining('watercolor'),
        }),
      }),
    );
  });

  it('rejects video-generation requests without a prompt', async () => {
    const { POST } = await import('@/app/api/generate/video/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/video', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('generates videos with normalized provider options', async () => {
    normalizeVideoOptionsMock.mockReturnValue({
      prompt: 'Animate the experiment',
      duration: 5,
      aspectRatio: '16:9',
      resolution: '720p',
    });
    generateVideoMock.mockResolvedValue({
      url: 'https://cdn.example.com/video.mp4',
      width: 1280,
      height: 720,
      duration: 5,
    });

    const { POST } = await import('@/app/api/generate/video/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/video', {
        method: 'POST',
        headers: {
          'x-video-provider': 'seedance',
        },
        body: JSON.stringify({
          prompt: 'Animate the experiment',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.result.url).toBe('https://cdn.example.com/video.mp4');
    expect(generateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'seedance',
        apiKey: 'server-key',
        baseUrl: 'https://provider.example.com',
        model: 'provider-model',
      }),
      expect.objectContaining({
        duration: 5,
        resolution: '720p',
      }),
    );
  });

  it('routes video generation through the scenario bucket even when the request hints a different provider', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        video: [
          { providerId: 'seedance', modelId: 'doubao-seedance-1-5-pro-251215' },
          { providerId: 'kling', modelId: 'kling-v2-6' },
        ],
      },
    });
    normalizeVideoOptionsMock.mockImplementation((providerId, options) =>
      providerId === 'seedance'
        ? {
            ...options,
            duration: 5,
            aspectRatio: '16:9',
            resolution: '720p',
          }
        : options,
    );
    generateVideoMock.mockResolvedValue({
      url: 'https://cdn.example.com/video.mp4',
      width: 1280,
      height: 720,
      duration: 5,
    });

    const { POST } = await import('@/app/api/generate/video/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/video', {
        method: 'POST',
        headers: {
          'x-video-provider': 'kling',
          'x-video-model': 'kling-v2-6',
        },
        body: JSON.stringify({
          prompt: 'Animate a group experiment',
          duration: 5,
          aspectRatio: '16:9',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'video',
        providerId: 'seedance',
        requestedModel: 'doubao-seedance-1-5-pro-251215',
      }),
    );
    expect(generateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'seedance',
        model: 'doubao-seedance-1-5-pro-251215',
      }),
      expect.objectContaining({
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      }),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'generate-video',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'video',
          routeId: 'generate-video',
          selectedProviderId: 'seedance',
          selectedModelId: 'doubao-seedance-1-5-pro-251215',
          validationStatus: 'selected',
          requestedProviderId: 'kling',
          requestedModelId: 'kling-v2-6',
        }),
      }),
    );
    expect(body.success).toBe(true);
  });

  it('falls back to the next validated video scenario candidate when the first provider resolves to an unsafe base URL', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        video: [
          { providerId: 'veo', modelId: 'veo-3.1-fast-generate-001' },
          { providerId: 'seedance', modelId: 'doubao-seedance-1-5-pro-251215' },
        ],
      },
    });
    resolveGovernedProviderConfigMock
      .mockResolvedValueOnce({
        providerId: 'veo',
        apiKey: 'server-key',
        baseUrl: 'http://127.0.0.1:1234',
        modelId: 'veo-3.1-fast-generate-001',
      })
      .mockResolvedValueOnce({
        providerId: 'seedance',
        apiKey: 'server-key',
        baseUrl: 'https://video.example.com',
        modelId: 'doubao-seedance-1-5-pro-251215',
      });
    validateUrlForSSRFMock.mockResolvedValueOnce('Local/private network URLs are not allowed');
    validateUrlForSSRFMock.mockResolvedValueOnce(null);
    normalizeVideoOptionsMock.mockImplementation((providerId, options) =>
      providerId === 'veo'
        ? {
            ...options,
            duration: 8,
            aspectRatio: '16:9',
            resolution: '720p',
          }
        : {
            ...options,
            duration: 5,
            aspectRatio: '16:9',
            resolution: '720p',
          },
    );
    generateVideoMock.mockResolvedValue({
      url: 'https://cdn.example.com/video.mp4',
      width: 1280,
      height: 720,
      duration: 5,
    });

    const { POST } = await import('@/app/api/generate/video/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/video', {
        method: 'POST',
        headers: {
          'x-video-provider': 'veo',
          'x-video-model': 'veo-3.1-fast-generate-001',
        },
        body: JSON.stringify({
          prompt: 'Animate the launch sequence',
          duration: 8,
          aspectRatio: '16:9',
          resolution: '720p',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'video',
        providerId: 'veo',
        requestedModel: 'veo-3.1-fast-generate-001',
      }),
    );
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        family: 'video',
        providerId: 'seedance',
        requestedModel: 'doubao-seedance-1-5-pro-251215',
      }),
    );
    expect(generateVideoMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'seedance',
        model: 'doubao-seedance-1-5-pro-251215',
      }),
      expect.objectContaining({
        duration: 5,
        aspectRatio: '16:9',
        resolution: '720p',
      }),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'generate-video',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'video',
          routeId: 'generate-video',
          selectedProviderId: 'seedance',
          selectedModelId: 'doubao-seedance-1-5-pro-251215',
          fallbackProviderId: 'seedance',
          fallbackModelId: 'doubao-seedance-1-5-pro-251215',
          validationStatus: 'fallback_selected',
          requestedProviderId: 'veo',
          requestedModelId: 'veo-3.1-fast-generate-001',
          fallbackReason: expect.stringContaining('veo:veo-3.1-fast-generate-001'),
        }),
      }),
    );
    expect(body.success).toBe(true);
  });

  it('fails closed for scenario-managed video generation when every candidate is uncredentialed', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
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
              headers: { 'Content-Type': 'application/json' },
            },
          )
        : null,
    );

    const { POST } = await import('@/app/api/generate/video/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/video', {
        method: 'POST',
        headers: {
          'x-video-provider': 'seedance',
        },
        body: JSON.stringify({
          prompt: 'Animate the experiment',
          duration: 5,
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
    expect(generateVideoMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_denied',
        resourceType: 'provider_scenario',
        resourceId: 'generate-video',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'video',
          routeId: 'generate-video',
          selectedProviderId: null,
          selectedModelId: null,
          validationStatus: 'failed_closed',
          fallbackReason: expect.stringContaining('seedance:doubao-seedance-1-5-pro-251215'),
        }),
      }),
    );
  });

  it('rejects TTS generation when required fields are missing', async () => {
    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/tts', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello world',
          audioId: 'audio-1',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('returns base64-encoded audio for generated speech', async () => {
    generateTTSMock.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]),
      format: 'mp3',
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/tts', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello world',
          audioId: 'audio-1',
          ttsProviderId: 'openai-tts',
          ttsVoice: 'alloy',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      audioId: 'audio-1',
      base64: 'AQID',
      format: 'mp3',
    });
  });

  it('routes TTS through the scenario bucket and falls back when a voice is unsupported', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        tts: [
          { providerId: 'openai-tts', modelId: 'gpt-4o-mini-tts' },
          { providerId: 'qwen-tts', modelId: 'qwen3-tts-flash' },
        ],
      },
    });
    generateTTSMock.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]),
      format: 'mp3',
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/tts', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello world',
          audioId: 'audio-1',
          ttsProviderId: 'qwen-tts',
          ttsModelId: 'qwen3-tts-flash',
          ttsVoice: 'Cherry',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'tts',
        providerId: 'openai-tts',
        requestedModel: 'gpt-4o-mini-tts',
      }),
    );
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        family: 'tts',
        providerId: 'qwen-tts',
        requestedModel: 'qwen3-tts-flash',
      }),
    );
    expect(generateTTSMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'qwen-tts',
        modelId: 'qwen3-tts-flash',
        voice: 'Cherry',
      }),
      'Hello world',
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'generate-tts',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'tts',
          routeId: 'generate-tts',
          selectedProviderId: 'qwen-tts',
          selectedModelId: 'qwen3-tts-flash',
          fallbackProviderId: 'qwen-tts',
          fallbackModelId: 'qwen3-tts-flash',
          validationStatus: 'fallback_selected',
          requestedProviderId: 'qwen-tts',
          requestedModelId: 'qwen3-tts-flash',
          fallbackReason: expect.stringContaining('openai-tts:gpt-4o-mini-tts'),
        }),
      }),
    );
    expect(body.success).toBe(true);
  });

  it('honors TTS voice compatible-model constraints before selecting a scenario candidate', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        tts: [
          { providerId: 'openai-tts', modelId: 'tts-1' },
          { providerId: 'openai-tts', modelId: 'gpt-4o-mini-tts' },
        ],
      },
    });
    generateTTSMock.mockResolvedValue({
      audio: new Uint8Array([1, 2, 3]),
      format: 'mp3',
    });

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/tts', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello world',
          audioId: 'audio-1',
          ttsProviderId: 'openai-tts',
          ttsVoice: 'marin',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'tts',
        providerId: 'openai-tts',
        requestedModel: 'tts-1',
      }),
    );
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        family: 'tts',
        providerId: 'openai-tts',
        requestedModel: 'gpt-4o-mini-tts',
      }),
    );
    expect(generateTTSMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai-tts',
        modelId: 'gpt-4o-mini-tts',
        voice: 'marin',
      }),
      'Hello world',
    );
    expect(body.success).toBe(true);
  });

  it('fails closed for scenario-managed TTS when no validated candidate remains', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        tts: [{ providerId: 'openai-tts', modelId: 'gpt-4o-mini-tts' }],
      },
    });
    const missingCredentialsError = new MockGovernedProviderResolutionError(
      'MISSING_PROVIDER_CREDENTIALS',
      'No API key configured for provider "openai-tts".',
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
              headers: { 'Content-Type': 'application/json' },
            },
          )
        : null,
    );

    const { POST } = await import('@/app/api/generate/tts/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate/tts', {
        method: 'POST',
        body: JSON.stringify({
          text: 'Hello world',
          audioId: 'audio-1',
          ttsProviderId: 'openai-tts',
          ttsVoice: 'alloy',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
    expect(generateTTSMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_denied',
        resourceType: 'provider_scenario',
        resourceId: 'generate-tts',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'tts',
          routeId: 'generate-tts',
          selectedProviderId: null,
          selectedModelId: null,
          validationStatus: 'failed_closed',
          fallbackReason: expect.stringContaining('openai-tts:gpt-4o-mini-tts'),
        }),
      }),
    );
  });

  it('rejects PDF parsing requests with the wrong content type', async () => {
    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(
      new NextRequest('http://localhost/api/parse-pdf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('INVALID_REQUEST');
  });

  it('parses PDF uploads and returns file metadata', async () => {
    parsePDFMock.mockResolvedValue({
      text: 'PDF content',
      metadata: { pageCount: 2 },
    });

    const formData = new FormData();
    formData.set(
      'pdf',
      new File([new Uint8Array([1, 2, 3])], 'lesson.pdf', { type: 'application/pdf' }),
    );

    const { POST } = await import('@/app/api/parse-pdf/route');
    const response = await POST(
      new NextRequest('http://localhost/api/parse-pdf', {
        method: 'POST',
        body: formData,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.metadata).toEqual(
      expect.objectContaining({
        fileName: 'lesson.pdf',
        pageCount: 2,
        fileSize: 3,
      }),
    );
  });

  it('rejects transcription requests without an audio file', async () => {
    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(
      new NextRequest('http://localhost/api/transcription', {
        method: 'POST',
        body: new FormData(),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
  });

  it('transcribes uploaded audio with the resolved ASR provider', async () => {
    transcribeAudioMock.mockResolvedValue({ text: 'Hello world' });

    const formData = new FormData();
    formData.set(
      'audio',
      new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' }),
    );
    formData.set('providerId', 'openai-whisper');

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(
      new NextRequest('http://localhost/api/transcription', {
        method: 'POST',
        body: formData,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      text: 'Hello world',
    });
  });

  it('routes transcription through the scenario bucket even when the request hints a different provider', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        transcript: [
          { providerId: 'openai-whisper', modelId: 'gpt-4o-mini-transcribe' },
          { providerId: 'qwen-asr', modelId: 'qwen3-asr-flash' },
        ],
      },
    });
    transcribeAudioMock.mockResolvedValue({ text: 'Hello world' });

    const formData = new FormData();
    formData.set(
      'audio',
      new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' }),
    );
    formData.set('providerId', 'qwen-asr');
    formData.set('modelId', 'qwen3-asr-flash');

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(
      new NextRequest('http://localhost/api/transcription', {
        method: 'POST',
        body: formData,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'asr',
        providerId: 'openai-whisper',
        requestedModel: 'gpt-4o-mini-transcribe',
      }),
    );
    expect(transcribeAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai-whisper',
        modelId: 'gpt-4o-mini-transcribe',
      }),
      expect.any(Buffer),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'transcription',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'transcript',
          routeId: 'transcription',
          selectedProviderId: 'openai-whisper',
          selectedModelId: 'gpt-4o-mini-transcribe',
          validationStatus: 'selected',
          requestedProviderId: 'qwen-asr',
          requestedModelId: 'qwen3-asr-flash',
        }),
      }),
    );
    expect(body).toEqual({
      success: true,
      text: 'Hello world',
    });
  });

  it('rejects client-only ASR candidates and falls back to the next validated scenario candidate', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        transcript: [
          { providerId: 'browser-native' },
          { providerId: 'openai-whisper', modelId: 'whisper-1' },
        ],
      },
    });
    transcribeAudioMock.mockResolvedValue({ text: 'Hello world' });

    const formData = new FormData();
    formData.set(
      'audio',
      new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' }),
    );
    formData.set('providerId', 'browser-native');

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(
      new NextRequest('http://localhost/api/transcription', {
        method: 'POST',
        body: formData,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        family: 'asr',
        providerId: 'browser-native',
      }),
    );
    expect(resolveGovernedProviderConfigMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        family: 'asr',
        providerId: 'openai-whisper',
        requestedModel: 'whisper-1',
      }),
    );
    expect(transcribeAudioMock).toHaveBeenCalledWith(
      expect.objectContaining({
        providerId: 'openai-whisper',
        modelId: 'whisper-1',
      }),
      expect.any(Buffer),
    );
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_selected',
        resourceType: 'provider_scenario',
        resourceId: 'transcription',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'transcript',
          routeId: 'transcription',
          selectedProviderId: 'openai-whisper',
          selectedModelId: 'whisper-1',
          validationStatus: 'fallback_selected',
          fallbackReason: expect.stringContaining('browser-native'),
        }),
      }),
    );
    expect(body).toEqual({
      success: true,
      text: 'Hello world',
    });
  });

  it('fails closed for scenario-managed transcription when credentials are missing for every candidate', async () => {
    getProviderScenarioProfileMock.mockReturnValue({
      id: 'teacher-differentiation-v1',
      description: 'Scenario-managed provider routing.',
      buckets: {
        transcript: [{ providerId: 'openai-whisper', modelId: 'gpt-4o-mini-transcribe' }],
      },
    });
    const missingCredentialsError = new MockGovernedProviderResolutionError(
      'MISSING_PROVIDER_CREDENTIALS',
      'No API key configured for provider "openai-whisper".',
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
              headers: { 'Content-Type': 'application/json' },
            },
          )
        : null,
    );

    const formData = new FormData();
    formData.set(
      'audio',
      new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' }),
    );

    const { POST } = await import('@/app/api/transcription/route');
    const response = await POST(
      new NextRequest('http://localhost/api/transcription', {
        method: 'POST',
        body: formData,
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
    expect(transcribeAudioMock).not.toHaveBeenCalled();
    expect(appendAuditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'provider_scenario.route_denied',
        resourceType: 'provider_scenario',
        resourceId: 'transcription',
        metadata: expect.objectContaining({
          scenarioProfileId: 'teacher-differentiation-v1',
          taskBucket: 'transcript',
          routeId: 'transcription',
          selectedProviderId: null,
          selectedModelId: null,
          validationStatus: 'failed_closed',
          fallbackReason: expect.stringContaining('openai-whisper:gpt-4o-mini-transcribe'),
        }),
      }),
    );
  });
});
