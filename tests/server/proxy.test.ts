import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { ACCESS_CODE_COOKIE_NAME, createAccessToken } from '@/lib/server/access-code';

const resolveSessionFromTokenMock = vi.fn();

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    resolveSessionFromToken: resolveSessionFromTokenMock,
  };
});

describe('proxy auth refresh', () => {
  beforeEach(() => {
    vi.resetModules();
    resolveSessionFromTokenMock.mockReset();
    vi.unstubAllEnvs();
  });

  it('refreshes a valid web session on protected page routes', async () => {
    resolveSessionFromTokenMock.mockResolvedValue({
      id: 'session-1',
      kind: 'web',
      expiresAt: '2026-01-01T00:00:00.000Z',
      absoluteExpiresAt: '2026-01-20T00:00:00.000Z',
    });

    const { proxy } = await import('../../proxy');
    const response = await proxy(
      new NextRequest('http://localhost/admin', {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=session-token`,
        },
      }),
    );

    expect(response.status).toBe(200);
    const sessionCookie = response.cookies.get(SESSION_COOKIE_NAME);
    expect(sessionCookie?.value).toBe('session-token');
    expect(new Date(sessionCookie?.expires ?? 0).toISOString()).toBe('2026-01-20T00:00:00.000Z');
  });

  it('clears invalid web session cookies and redirects to sign-in', async () => {
    resolveSessionFromTokenMock.mockResolvedValue(null);

    const { proxy } = await import('../../proxy');
    const response = await proxy(
      new NextRequest('http://localhost/studio?tab=recent', {
        headers: {
          cookie: `${SESSION_COOKIE_NAME}=stale-token`,
        },
      }),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe(
      'http://localhost/sign-in?next=%2Fstudio%3Ftab%3Drecent',
    );
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('');
  });

  it('allows access-code bootstrap routes without an access cookie', async () => {
    vi.stubEnv('ACCESS_CODE', 'secret-code');

    const { proxy } = await import('../../proxy');
    const response = await proxy(new NextRequest('http://localhost/api/server-providers'));

    expect(response.status).toBe(200);
  });

  it('rejects protected api routes when the access-code cookie is missing', async () => {
    vi.stubEnv('ACCESS_CODE', 'secret-code');

    const { proxy } = await import('../../proxy');
    const response = await proxy(new NextRequest('http://localhost/api/chat'));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'Access code required',
    });
  });

  it('allows protected api routes when the access-code cookie is valid', async () => {
    vi.stubEnv('ACCESS_CODE', 'secret-code');

    const { proxy } = await import('../../proxy');
    const accessToken = createAccessToken('secret-code');
    const response = await proxy(
      new NextRequest('http://localhost/api/chat', {
        headers: {
          cookie: `${ACCESS_CODE_COOKIE_NAME}=${accessToken}`,
        },
      }),
    );

    expect(response.status).toBe(200);
  });
});
