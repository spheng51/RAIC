import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';

const findJoinTokenByHashMock = vi.fn();
const recordAuditEventMock = vi.fn();
const createClassroomGuestUserMock = vi.fn();
const ensureMembershipMock = vi.fn();
const createClassroomSessionMock = vi.fn();
const resolveAuthContextFromTokenMock = vi.fn();
const readClassroomMock = vi.fn();

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

vi.mock('@/lib/server/classroom-storage', () => ({
  readClassroom: readClassroomMock,
}));

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('/join/[joinCode]/enter', () => {
  beforeEach(() => {
    vi.resetModules();
    findJoinTokenByHashMock.mockReset();
    recordAuditEventMock.mockReset();
    createClassroomGuestUserMock.mockReset();
    ensureMembershipMock.mockReset();
    createClassroomSessionMock.mockReset();
    resolveAuthContextFromTokenMock.mockReset();
    readClassroomMock.mockReset();
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: { id: 'room-1', name: 'Physics' },
      scenes: [],
      createdAt: new Date().toISOString(),
    });
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

  it('creates a classroom session with the legacy Student fallback on GET', async () => {
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
    expect(readClassroomMock).toHaveBeenCalledWith('room-1');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe(
      'classroom-session-token',
    );
    expect(createClassroomGuestUserMock).toHaveBeenCalledWith({
      displayName: 'Student',
      emailHint: 'Student',
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
        metadata: expect.objectContaining({
          displayName: 'Student',
        }),
      }),
    );
  });

  it('creates a classroom session with the submitted display name on POST', async () => {
    findJoinTokenByHashMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      organizationId: 'org-1',
      displayName: 'Physics',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });

    const { POST } = await import('@/app/(student)/join/[joinCode]/enter/route');
    const response = await POST(
      new NextRequest('http://localhost/join/raw-token/enter', {
        method: 'POST',
        body: new URLSearchParams({ displayName: 'Ada Lovelace' }),
      }),
      {
        params: Promise.resolve({ joinCode: 'raw-token' }),
      },
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/classroom/room-1');
    expect(createClassroomGuestUserMock).toHaveBeenCalledWith({
      displayName: 'Ada Lovelace',
      emailHint: 'Ada Lovelace',
    });
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.join_token.redeemed',
        metadata: expect.objectContaining({
          displayName: 'Ada Lovelace',
        }),
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
    expect(readClassroomMock).not.toHaveBeenCalled();
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
    expect(readClassroomMock).toHaveBeenCalledWith('room-1');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe(
      'existing-classroom-token',
    );
    expect(createClassroomGuestUserMock).not.toHaveBeenCalled();
    expect(ensureMembershipMock).not.toHaveBeenCalled();
    expect(createClassroomSessionMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('redirects back without creating a session when the classroom record is missing', async () => {
    findJoinTokenByHashMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      organizationId: 'org-1',
      displayName: 'Physics',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    readClassroomMock.mockResolvedValue(null);

    const { GET } = await import('@/app/(student)/join/[joinCode]/enter/route');
    const response = await GET(new NextRequest('http://localhost/join/raw-token/enter'), {
      params: Promise.resolve({ joinCode: 'raw-token' }),
    });

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/join/raw-token');
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
    expect(readClassroomMock).toHaveBeenCalledWith('room-1');
    expect(createClassroomGuestUserMock).not.toHaveBeenCalled();
    expect(ensureMembershipMock).not.toHaveBeenCalled();
    expect(createClassroomSessionMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });
});
