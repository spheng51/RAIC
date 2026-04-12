import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';

const resolveSessionFromTokenMock = vi.fn();

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    resolveSessionFromToken: resolveSessionFromTokenMock,
  };
});

describe('withRequestWebSession', () => {
  beforeEach(() => {
    vi.resetModules();
    resolveSessionFromTokenMock.mockReset();
  });

  it('reissues the web session cookie against the absolute expiry', async () => {
    resolveSessionFromTokenMock.mockResolvedValue({
      id: 'session-1',
      kind: 'web',
      expiresAt: '2026-01-01T00:00:00.000Z',
      absoluteExpiresAt: '2026-01-20T00:00:00.000Z',
    });

    const { withRequestWebSession } = await import('@/lib/server/api-response');
    const request = new NextRequest('http://localhost/api/ai/options', {
      headers: {
        cookie: `${SESSION_COOKIE_NAME}=session-token`,
      },
    });
    const response = await withRequestWebSession(request, NextResponse.json({ success: true }));

    const sessionCookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(sessionCookie?.value).toBe('session-token');
    expect(new Date(sessionCookie?.expires ?? 0).toISOString()).toBe('2026-01-20T00:00:00.000Z');
  });
});
