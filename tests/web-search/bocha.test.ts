import { beforeEach, describe, expect, it, vi } from 'vitest';

const proxyFetchMock = vi.hoisted(() => vi.fn());

vi.mock('@/lib/server/proxy-fetch', () => ({
  proxyFetch: proxyFetchMock,
}));

import { searchWithBocha } from '@/lib/web-search/bocha';

describe('Bocha web search', () => {
  beforeEach(() => {
    proxyFetchMock.mockReset();
  });

  it('maps Bocha web pages into normalized web search sources', async () => {
    proxyFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          code: 200,
          data: {
            queryContext: { originalQuery: 'cell biology' },
            webPages: {
              value: [
                {
                  name: 'Cells',
                  url: 'https://example.com/cells',
                  summary: 'Cells are the basic unit of life.',
                },
              ],
            },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await searchWithBocha({
      query: 'cell biology',
      apiKey: 'bocha-key',
      maxResults: 100,
      baseUrl: 'https://api.bocha.cn/v1',
    });

    expect(proxyFetchMock).toHaveBeenCalledWith(
      'https://api.bocha.cn/v1/web-search',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer bocha-key',
        }),
      }),
    );
    const body = JSON.parse((proxyFetchMock.mock.calls[0]?.[1] as RequestInit).body as string);
    expect(body).toMatchObject({
      query: 'cell biology',
      freshness: 'noLimit',
      summary: true,
      count: 50,
    });
    expect(result.sources).toEqual([
      {
        title: 'Cells',
        url: 'https://example.com/cells',
        content: 'Cells are the basic unit of life.',
        score: 0,
      },
    ]);
    expect(result.query).toBe('cell biology');
  });
});
