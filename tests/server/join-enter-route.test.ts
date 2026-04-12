import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';

const findJoinTokenByHashMock = vi.fn();
const recordAuditEventMock = vi.fn();
const createClassroomGuestUserMock = vi.fn();
const ensureMembershipMock = vi.fn();
const createClassroomSessionMock = vi.fn();
const resolveAuthContextFromTokenMock = vi.fn();

vi.mock('@/lib/db/repositories/join-tokens', () => ({
  findJoinTokenByHash: findJoinTokenByHashMock,
}));

vi.mock('@/lib/db/repositories/users', () => ({
  createClassroomGuestUser: createClassroomGuestUserMock,
}));

vi.mock('@/lib/db/repositories/memberships', () => ({
  ensureMembership: ensureMembershipMock,
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    createClassroomSession: createClassroomSessionMock,
  };
});

vi.mock('@/lib/auth/current-user', () => ({
  resolveAuthContextFromToken: resolveAuthContextFromTokenMock,
}));

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('GET /join/[joinCode]/enter', () => {
  beforeEach(() => {
    vi.resetModules();
    findJoinTokenByHashMock.mockReset();
    recordAuditEventMock.mockReset();
    createClassroomGuestUserMock.mockReset();
    ensureMembershipMock.mockReset();
    createClassroomSessionMock.mockReset();
    resolveAuthContextFromTokenMock.mockReset();
    createClassroomGuestUserMock.mockResolvedValue({
      id: 'student-1',
      displayName: 'Physics',
    });
    ensureMembershipMock.mockResolvedValue({
      id: 'membership-1',
    });
    createClassroomSessionMock.mockResolvedValue({
      token: 'classroom-session-token',
      session: {
        id: 'session-1',
        absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
    });
    resolveAuthContextFromTokenMock.mockResolvedValue(null);
  });

  it('creates a classroom session and redirects to the classroom for a valid token', async () => {
    findJoinTokenByHashMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      organizationId: 'org-1',
      displayName: 'Physics',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const { GET } = await import('@/app/(student)/join/[joinCode]/enter/route');
    const response = await GET(new NextRequest('http://localhost/join/raw-token/enter'), {
      params: Promise.resolve({ joinCode: 'raw-token' }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/classroom/room-1');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe(
      'classroom-session-token',
    );
    expect(createClassroomGuestUserMock).toHaveBeenCalledWith({
      displayName: 'Physics',
      emailHint: 'Physics',
    });
    expect(ensureMembershipMock).toHaveBeenCalledWith({
      organizationId: 'org-1',
      userId: 'student-1',
      role: 'student',
    });
    expect(createClassroomSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'student-1',
        classroomId: 'room-1',
        organizationId: 'org-1',
      }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.join_token.redeemed',
        resourceId: 'room-1',
      }),
    );
  });

  it('clears the classroom cookie and redirects back when the token is expired', async () => {
    findJoinTokenByHashMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      organizationId: 'org-1',
      displayName: 'Physics',
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });

    const { GET } = await import('@/app/(student)/join/[joinCode]/enter/route');
    const response = await GET(new NextRequest('http://localhost/join/raw-token/enter'), {
      params: Promise.resolve({ joinCode: 'raw-token' }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/join/raw-token');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
    expect(createClassroomGuestUserMock).not.toHaveBeenCalled();
    expect(createClassroomSessionMock).not.toHaveBeenCalled();
  });

  it('reuses a matching classroom session instead of creating a new guest or session', async () => {
    findJoinTokenByHashMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      organizationId: 'org-1',
      displayName: 'Physics',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    resolveAuthContextFromTokenMock.mockResolvedValue({
      user: { id: 'student-1' },
      session: {
        id: 'session-existing',
        kind: 'classroom',
        role: 'student',
        classroomId: 'room-1',
        absoluteExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      },
      memberships: [],
      activeMembership: null,
      organization: null,
    });

    const { GET } = await import('@/app/(student)/join/[joinCode]/enter/route');
    const response = await GET(
      new NextRequest('http://localhost/join/raw-token/enter', {
        headers: {
          cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=existing-classroom-token`,
        },
      }),
      {
        params: Promise.resolve({ joinCode: 'raw-token' }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/classroom/room-1');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe(
      'existing-classroom-token',
    );
    expect(createClassroomGuestUserMock).not.toHaveBeenCalled();
    expect(ensureMembershipMock).not.toHaveBeenCalled();
    expect(createClassroomSessionMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
