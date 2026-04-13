import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const validateUrlForSSRFMock = vi.fn();
const fetchMock = vi.fn();

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

describe('POST /api/azure-voices', () => {
  beforeEach(() => {
    vi.resetModules();
    validateUrlForSSRFMock.mockReset();
    fetchMock.mockReset();
    validateUrlForSSRFMock.mockResolvedValue(null);
    vi.stubGlobal('fetch', fetchMock);
  });

  it('rejects requests without an API key', async () => {
    const { POST } = await import('@/app/api/azure-voices/route');
    const response = await POST(
      new NextRequest('http://localhost/api/azure-voices', {
        method: 'POST',
        body: JSON.stringify({ baseUrl: 'https://speech.example.com' }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_API_KEY');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the Azure voice list for valid credentials', async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify([{ ShortName: 'en-US-JennyNeural' }]), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { POST } = await import('@/app/api/azure-voices/route');
    const response = await POST(
      new NextRequest('http://localhost/api/azure-voices', {
        method: 'POST',
        body: JSON.stringify({
          apiKey: 'azure-key',
          baseUrl: 'https://speech.example.com',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      voices: [{ ShortName: 'en-US-JennyNeural' }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://speech.example.com/cognitiveservices/voices/list',
      expect.objectContaining({
        method: 'GET',
        redirect: 'manual',
        headers: {
          'Ocp-Apim-Subscription-Key': 'azure-key',
        },
      }),
    );
  });
});
