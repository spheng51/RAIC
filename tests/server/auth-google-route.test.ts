import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { AUTH_NONCE_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/lib/auth/constants';

const verifyGoogleIdTokenMock = vi.fn();
const upsertGoogleUserMock = vi.fn();
const findOrCreatePersonalOrganizationMock = vi.fn();
const ensureMembershipMock = vi.fn();
const listMembershipsForUserMock = vi.fn();
const createWebSessionMock = vi.fn();
const recordAuditEventMock = vi.fn();

vi.mock('@/lib/auth/google', () => ({
  verifyGoogleIdToken: verifyGoogleIdTokenMock,
}));

vi.mock('@/lib/auth/authorize', () => ({
  getDefaultLandingPath: (role: string) => (role === 'org_admin' ? '/admin' : '/studio'),
}));

vi.mock('@/lib/db/repositories/users', () => ({
  upsertGoogleUser: upsertGoogleUserMock,
}));

vi.mock('@/lib/db/repositories/organizations', () => ({
  findOrCreatePersonalOrganization: findOrCreatePersonalOrganizationMock,
}));

vi.mock('@/lib/db/repositories/memberships', () => ({
  ensureMembership: ensureMembershipMock,
  listMembershipsForUser: listMembershipsForUserMock,
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    createWebSession: createWebSessionMock,
    getRequestIpAddress: vi.fn(() => '127.0.0.1'),
  };
});

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('POST /api/auth/google', () => {
  beforeEach(() => {
    vi.resetModules();
    verifyGoogleIdTokenMock.mockReset();
    upsertGoogleUserMock.mockReset();
    findOrCreatePersonalOrganizationMock.mockReset();
    ensureMembershipMock.mockReset();
    listMembershipsForUserMock.mockReset();
    createWebSessionMock.mockReset();
    recordAuditEventMock.mockReset();
  });

  it('rejects sign-in when the nonce cookie is missing', async () => {
    const { POST } = await import('@/app/api/auth/google/route');
    const response = await POST(
      new NextRequest('http://localhost/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({
          credential: 'credential-token',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errorCode).toBe('MISSING_NONCE');
    expect(verifyGoogleIdTokenMock).not.toHaveBeenCalled();
    expect(response.cookies.get(AUTH_NONCE_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('');
  });

  it('clears cookies when Google token verification fails with a nonce mismatch', async () => {
    verifyGoogleIdTokenMock.mockRejectedValue(new Error('Google credential nonce mismatch'));

    const { POST } = await import('@/app/api/auth/google/route');
    const response = await POST(
      new NextRequest('http://localhost/api/auth/google', {
        method: 'POST',
        headers: {
          cookie: `${AUTH_NONCE_COOKIE_NAME}=nonce-123`,
        },
        body: JSON.stringify({
          credential: 'credential-token',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.errorCode).toBe('GOOGLE_AUTH_FAILED');
    expect(response.cookies.get(AUTH_NONCE_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('');
  });

  it('creates a session when nonce validation and identity resolution succeed', async () => {
    verifyGoogleIdTokenMock.mockResolvedValue({
      googleSub: 'google-sub-1',
      email: 'teacher@example.com',
      displayName: 'Teacher',
      avatarUrl: null,
    });
    upsertGoogleUserMock.mockResolvedValue({
      id: 'user-1',
      email: 'teacher@example.com',
    });
    findOrCreatePersonalOrganizationMock.mockResolvedValue({
      id: 'org-1',
      name: 'Teacher workspace',
    });
    ensureMembershipMock.mockResolvedValue({
      role: 'teacher',
    });
    createWebSessionMock.mockResolvedValue({
      token: 'session-token',
      session: {
        id: 'session-1',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    listMembershipsForUserMock.mockResolvedValue([{ id: 'membership-1' }]);

    const { POST } = await import('@/app/api/auth/google/route');
    const response = await POST(
      new NextRequest('http://localhost/api/auth/google', {
        method: 'POST',
        headers: {
          cookie: `${AUTH_NONCE_COOKIE_NAME}=nonce-123`,
        },
        body: JSON.stringify({
          credential: 'credential-token',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.redirectTo).toBe('/studio');
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('session-token');
    expect(response.cookies.get(AUTH_NONCE_COOKIE_NAME)?.value).toBe('');
  });
});
