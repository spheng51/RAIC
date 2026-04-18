import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ACCESS_CODE_TOKEN_TTL_SECONDS, createAccessToken } from '@/lib/server/access-code';

const LEGACY_ACCESS_CODE_COOKIE_NAME = ['open', 'maic_access'].join('');

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
};

const cookiesMock = vi.fn();
const attachNonceCookieMock = vi.fn();
const createNonceTokenMock = vi.fn();

vi.mock('next/headers', () => ({
  cookies: cookiesMock,
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    attachNonceCookie: attachNonceCookieMock,
    createNonceToken: createNonceTokenMock,
  };
});

describe('access code routes and auth nonce', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    cookiesMock.mockResolvedValue(cookieStore);
    cookieStore.get.mockReset();
    cookieStore.set.mockReset();
    attachNonceCookieMock.mockReset();
    createNonceTokenMock.mockReset();
  });

  it('reports access-code auth as disabled when no code is configured', async () => {
    const { GET } = await import('@/app/api/access-code/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      enabled: false,
      authenticated: true,
    });
  });

  it('reports authenticated when the access-code cookie contains a valid token', async () => {
    vi.stubEnv('ACCESS_CODE', 'open-sesame');
    cookieStore.get.mockReturnValue({
      value: createAccessToken('open-sesame'),
    });

    const { GET } = await import('@/app/api/access-code/status/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      enabled: true,
      authenticated: true,
    });
    expect(cookieStore.get).toHaveBeenCalledTimes(1);
    expect(cookieStore.get).toHaveBeenCalledWith('openraic_access');
    expect(cookieStore.get).not.toHaveBeenCalledWith(LEGACY_ACCESS_CODE_COOKIE_NAME);
  });

  it('rejects invalid access-code submissions', async () => {
    vi.stubEnv('ACCESS_CODE', 'open-sesame');

    const { POST } = await import('@/app/api/access-code/verify/route');
    const response = await POST(
      new Request('http://localhost/api/access-code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'wrong-code' }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(401);
    expect(body.errorCode).toBe('INVALID_REQUEST');
    expect(cookieStore.set).not.toHaveBeenCalled();
  });

  it('accepts a valid access code and writes the auth cookie', async () => {
    vi.stubEnv('ACCESS_CODE', 'open-sesame');

    const { POST } = await import('@/app/api/access-code/verify/route');
    const response = await POST(
      new Request('http://localhost/api/access-code/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: 'open-sesame' }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      valid: true,
    });
    expect(cookieStore.set).toHaveBeenCalledTimes(1);
    expect(cookieStore.set).toHaveBeenCalledWith(
      'openraic_access',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        path: '/',
        sameSite: 'lax',
        maxAge: ACCESS_CODE_TOKEN_TTL_SECONDS,
      }),
    );
  });

  it('returns a nonce and attaches the nonce cookie', async () => {
    createNonceTokenMock.mockReturnValue('nonce-123');

    const { GET } = await import('@/app/api/auth/nonce/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      success: true,
      nonce: 'nonce-123',
    });
    expect(attachNonceCookieMock).toHaveBeenCalledWith(response, 'nonce-123');
  });
});
