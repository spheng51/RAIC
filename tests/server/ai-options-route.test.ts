import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';

const getRequestAuthMock = vi.fn();
const getEffectiveAIOptionsMock = vi.fn();
const resolveSessionFromTokenMock = vi.fn();

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  getEffectiveAIOptions: getEffectiveAIOptionsMock,
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    resolveSessionFromToken: resolveSessionFromTokenMock,
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

describe('GET /api/ai/options', () => {
  beforeEach(() => {
    vi.resetModules();
    getRequestAuthMock.mockReset();
    getEffectiveAIOptionsMock.mockReset();
    resolveSessionFromTokenMock.mockReset();
  });

  it('refreshes the web session cookie on a successful authenticated response', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'web', expiresAt: '2026-01-01T00:00:00.000Z' },
      user: { id: 'teacher-1' },
    });
    getEffectiveAIOptionsMock.mockResolvedValue({
      families: [],
    });
    resolveSessionFromTokenMock.mockResolvedValue({
      id: 'session-1',
      kind: 'web',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });

    const { GET } = await import('@/app/api/ai/options/route');
    const response = await GET(
      new NextRequest('http://localhost/api/ai/options', {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=session-token`,
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('session-token');
  });
});
