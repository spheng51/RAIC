import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import {
  AUTH_NONCE_COOKIE_NAME,
  CLASSROOM_ACCESS_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '@/lib/auth/constants';

const getRequestAuthMock = vi.fn();
const revokeSessionByIdMock = vi.fn();
const recordAuditEventMock = vi.fn();

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
}));

vi.mock('@/lib/db/repositories/sessions', () => ({
  revokeSessionById: revokeSessionByIdMock,
}));

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    vi.resetModules();
    getRequestAuthMock.mockReset();
    revokeSessionByIdMock.mockReset();
    recordAuditEventMock.mockReset();
  });

  it('clears web, nonce, and classroom cookies during logout', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'session-1', organizationId: 'org-1', role: 'teacher' },
      user: { id: 'user-1' },
    });

    const { POST } = await import('@/app/api/auth/logout/route');
    const response = await POST(
      new NextRequest('http://localhost/api/auth/logout', {
        method: 'POST',
        headers: {
          cookie: [
            `${SESSION_COOKIE_NAME}=session-token`,
            `${AUTH_NONCE_COOKIE_NAME}=nonce-token`,
            `${CLASSROOM_ACCESS_COOKIE_NAME}=classroom-token`,
          ].join('; '),
        },
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(response.cookies.get(SESSION_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get(AUTH_NONCE_COOKIE_NAME)?.value).toBe('');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
    expect(revokeSessionByIdMock).toHaveBeenCalledWith('session-1');
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'auth.sign_out',
        resourceId: 'session-1',
      }),
    );
  });
});
