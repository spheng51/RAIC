import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { generateWithGrokImage } from '@/lib/media/adapters/grok-image-adapter';

const mockFetch = vi.fn() as Mock;

vi.stubGlobal('fetch', mockFetch);

describe('grok image adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  it('forwards the requested aspect ratio to xAI', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ url: 'https://img.example.com/generated.png' }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    await generateWithGrokImage(
      {
        providerId: 'grok-image',
        apiKey: 'xai-key',
      },
      {
        prompt: 'a kinetic energy classroom illustration',
        aspectRatio: '16:9',
      },
    );

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse((init as RequestInit).body as string);

    expect(body).toMatchObject({
      model: 'grok-imagine-image',
      prompt: 'a kinetic energy classroom illustration',
      aspect_ratio: '16:9',
      n: 1,
      response_format: 'url',
    });
  });

  it('includes the provider response body in non-OK errors', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('xAI image generation rejected the request: invalid aspect ratio', {
        status: 422,
        statusText: 'Unprocessable Entity',
      }),
    );

    await expect(
      generateWithGrokImage(
        {
          providerId: 'grok-image',
          apiKey: 'xai-key',
        },
        {
          prompt: 'a kinetic energy classroom illustration',
          aspectRatio: '16:9',
        },
      ),
    ).rejects.toThrow(
      'Grok image generation failed (422): xAI image generation rejected the request: invalid aspect ratio',
    );
  });
});
