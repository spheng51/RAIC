import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const aspectRatioToDimensionsMock = vi.fn();
const generateImageMock = vi.fn();
const generateTTSMock = vi.fn();
const generateVideoMock = vi.fn();
const getRequestAuthMock = vi.fn();
const normalizeVideoOptionsMock = vi.fn();
const parsePDFMock = vi.fn();
const resolveGovernedProviderConfigMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const transcribeAudioMock = vi.fn();
const validateUrlForSSRFMock = vi.fn();

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/audio/asr-providers', () => ({
  transcribeAudio: transcribeAudioMock,
}));

vi.mock('@/lib/audio/tts-providers', () => ({
  generateTTS: generateTTSMock,
}));

vi.mock('@/lib/media/image-providers', () => ({
  aspectRatioToDimensions: aspectRatioToDimensionsMock,
  generateImage: generateImageMock,
}));

vi.mock('@/lib/media/video-providers', () => ({
  generateVideo: generateVideoMock,
  normalizeVideoOptions: normalizeVideoOptionsMock,
}));

vi.mock('@/lib/pdf/pdf-providers', () => ({
  parsePDF: parsePDFMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  resolveGovernedProviderConfig: resolveGovernedProviderConfigMock,
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
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
    generateImageMock.mockReset();
    generateTTSMock.mockReset();
    generateVideoMock.mockReset();
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
    resolveGovernedProviderConfigMock.mockResolvedValue({
      apiKey: 'server-key',
      baseUrl: 'https://provider.example.com',
      modelId: 'provider-model',
    });
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
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
    formData.set('pdf', new File([new Uint8Array([1, 2, 3])], 'lesson.pdf', { type: 'application/pdf' }));

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
    formData.set('audio', new File([new Uint8Array([1, 2, 3])], 'speech.wav', { type: 'audio/wav' }));
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
});
