import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const getRequestAuthMock = vi.fn();
const resolveGovernedProviderConfigMock = vi.fn();
const resolveModelMock = vi.fn();

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/server/ai-governance', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/ai-governance')>();
  return {
    ...actual,
    resolveGovernedProviderConfig: resolveGovernedProviderConfigMock,
  };
});

vi.mock('@/lib/server/resolve-model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/resolve-model')>();
  return {
    ...actual,
    resolveModel: resolveModelMock,
  };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const authContext = {
  user: { id: 'teacher-1' },
  organization: { id: 'org-1' },
  session: { role: 'teacher' },
} as never;

async function createGovernanceError() {
  const { GovernedProviderResolutionError } =
    await vi.importActual<typeof import('@/lib/server/ai-governance')>(
      '@/lib/server/ai-governance'
    );

  return new GovernedProviderResolutionError(
    'PROVIDER_NOT_APPROVED',
    'Provider is not approved for this organization.',
    {
      status: 403,
      apiErrorCode: 'FORBIDDEN',
    },
  );
}

async function expectForbidden(responsePromise: Promise<Response>) {
  const response = await responsePromise;
  const json = await response.json();

  expect(response.status).toBe(403);
  expect(json.errorCode).toBe('FORBIDDEN');
}

describe('governed provider route error handling', () => {
  beforeEach(() => {
    vi.resetModules();
    getRequestAuthMock.mockReset();
    resolveGovernedProviderConfigMock.mockReset();
    resolveModelMock.mockReset();
    getRequestAuthMock.mockResolvedValue(authContext);
  });

  it('maps image generation governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/generate/image/route');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/generate/image', {
          method: 'POST',
          body: JSON.stringify({ prompt: 'Generate an image' }),
        }),
      ),
    );
  });

  it('maps TTS governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/generate/tts/route');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/generate/tts', {
          method: 'POST',
          body: JSON.stringify({
            text: 'hello',
            audioId: 'audio-1',
            ttsProviderId: 'openai-tts',
            ttsVoice: 'alloy',
          }),
        }),
      ),
    );
  });

  it('maps video generation governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/generate/video/route');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/generate/video', {
          method: 'POST',
          body: JSON.stringify({ prompt: 'Generate a video' }),
        }),
      ),
    );
  });

  it('maps PDF parsing governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/parse-pdf/route');
    const formData = new FormData();
    formData.set(
      'pdf',
      new File([new Uint8Array([1, 2, 3])], 'test.pdf', { type: 'application/pdf' }),
    );

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/parse-pdf', {
          method: 'POST',
          body: formData,
        }),
      ),
    );
  });

  it('maps transcription governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/transcription/route');
    const formData = new FormData();
    formData.set(
      'audio',
      new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' }),
    );
    formData.set('providerId', 'openai-whisper');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/transcription', {
          method: 'POST',
          body: formData,
        }),
      ),
    );
  });

  it('maps image verification governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/verify-image-provider/route');

    await expectForbidden(
      POST(new NextRequest('http://localhost/api/verify-image-provider', { method: 'POST' })),
    );
  });

  it('maps PDF verification governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/verify-pdf-provider/route');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/verify-pdf-provider', {
          method: 'POST',
          body: JSON.stringify({ providerId: 'mineru' }),
        }),
      ),
    );
  });

  it('maps video verification governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/verify-video-provider/route');

    await expectForbidden(
      POST(new NextRequest('http://localhost/api/verify-video-provider', { method: 'POST' })),
    );
  });

  it('maps model verification governance denials to 4xx', async () => {
    resolveModelMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/verify-model/route');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/verify-model', {
          method: 'POST',
          body: JSON.stringify({ model: 'openai:gpt-4o' }),
        }),
      ),
    );
  });

  it('maps web-search governance denials to 4xx', async () => {
    resolveGovernedProviderConfigMock.mockRejectedValue(await createGovernanceError());
    const { POST } = await import('@/app/api/web-search/route');

    await expectForbidden(
      POST(
        new NextRequest('http://localhost/api/web-search', {
          method: 'POST',
          body: JSON.stringify({ query: 'renewable energy' }),
        }),
      ),
    );
  });
});
