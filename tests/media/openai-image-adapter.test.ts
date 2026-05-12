import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { generateWithOpenAIImage } from '@/lib/media/adapters/openai-image-adapter';

const mockFetch = vi.fn() as Mock;

vi.stubGlobal('fetch', mockFetch);

describe('OpenAI image adapter', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    mockFetch.mockReset();
  });

  it('posts an image generation request to the OpenAI-compatible endpoint', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          data: [{ b64_json: 'abc123' }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      ),
    );

    const result = await generateWithOpenAIImage(
      {
        providerId: 'openai-image',
        apiKey: 'openai-key',
        baseUrl: 'https://api.openai.com/v1/',
        model: 'gpt-image-2',
      },
      {
        prompt: 'a classroom diagram',
        width: 1280,
        height: 720,
      },
    );

    expect(result).toEqual({ base64: 'abc123', url: undefined, width: 1280, height: 720 });
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.openai.com/v1/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer openai-key',
        }),
      }),
    );
    const body = JSON.parse((mockFetch.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      model: 'gpt-image-2',
      prompt: 'a classroom diagram',
      n: 1,
      size: '1280x720',
    });
  });
});
