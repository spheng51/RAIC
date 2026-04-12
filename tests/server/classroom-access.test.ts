import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';

const getRequestAuthMock = vi.fn();
const resolveAuthContextFromTokenMock = vi.fn();
const readClassroomMock = vi.fn();
const updateClassroomMock = vi.fn();
const findLatestAuditLogByActionAndResourceMock = vi.fn();

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
  resolveAuthContextFromToken: resolveAuthContextFromTokenMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    readClassroom: readClassroomMock,
    updateClassroom: updateClassroomMock,
  };
});

vi.mock('@/lib/db/repositories/audit-logs', () => ({
  findLatestAuditLogByActionAndResource: findLatestAuditLogByActionAndResourceMock,
}));

function classroomRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    ownerUserId: 'teacher-1',
    organizationId: 'org-1',
    stage: { id: 'room-1' },
    scenes: [],
    createdAt: '2026-04-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('classroom access helper', () => {
  beforeEach(() => {
    vi.resetModules();
    getRequestAuthMock.mockReset();
    getRequestAuthMock.mockResolvedValue(null);
    resolveAuthContextFromTokenMock.mockReset();
    resolveAuthContextFromTokenMock.mockResolvedValue(null);
    readClassroomMock.mockReset();
    readClassroomMock.mockResolvedValue(classroomRecord());
    updateClassroomMock.mockReset();
    findLatestAuditLogByActionAndResourceMock.mockReset();
    findLatestAuditLogByActionAndResourceMock.mockResolvedValue(null);
  });

  it('rejects unauthenticated requests without a classroom cookie', async () => {
    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');

    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('returns 404 when the classroom does not exist', async () => {
    readClassroomMock.mockResolvedValue(null);

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(404);
  });

  it('allows the owning teacher through the first-party session', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toEqual({
      auth: {
        session: { id: 'web-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
      classroom: classroomRecord(),
    });
    expect(resolveAuthContextFromTokenMock).not.toHaveBeenCalled();
  });

  it('allows same-org org admins', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'org_admin', organizationId: 'org-1' },
      user: { id: 'admin-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toEqual({
      auth: {
        session: { id: 'web-1', kind: 'web', role: 'org_admin', organizationId: 'org-1' },
        user: { id: 'admin-1' },
      },
      source: 'web',
      classroom: classroomRecord(),
    });
  });

  it('allows system admins globally', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'system_admin', organizationId: null },
      user: { id: 'sysadmin-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toEqual({
      auth: {
        session: { id: 'web-1', kind: 'web', role: 'system_admin', organizationId: null },
        user: { id: 'sysadmin-1' },
      },
      source: 'web',
      classroom: classroomRecord(),
    });
  });

  it('rejects non-owner teachers', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
      user: { id: 'teacher-2' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
  });

  it('rejects org admins from a different organization', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'org_admin', organizationId: 'org-2' },
      user: { id: 'admin-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
  });

  it('accepts a valid classroom session cookie for the matching classroom', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'classroom', classroomId: 'room-1', role: 'student' },
      user: { id: 'student-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=raw-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toEqual({
      auth: {
        session: { id: 'session-1', kind: 'classroom', classroomId: 'room-1', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
      classroom: classroomRecord(),
    });
  });

  it('clears the cookie when the classroom session does not match', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'classroom', classroomId: 'room-2', role: 'student' },
      user: { id: 'student-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=raw-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('clears the cookie when the classroom session has expired', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue(null);

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=session-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('clears the cookie when the session is not a classroom session', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'web', classroomId: null, role: 'student' },
      user: { id: 'student-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=session-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('backfills legacy ownership metadata from the classroom.created audit log', async () => {
    readClassroomMock.mockResolvedValue(
      classroomRecord({
        ownerUserId: null,
        organizationId: null,
      }),
    );
    findLatestAuditLogByActionAndResourceMock.mockResolvedValue({
      id: 'audit-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      actorRole: 'teacher',
      action: 'classroom.created',
      resourceType: 'classroom',
      resourceId: 'room-1',
      metadata: {},
      createdAt: '2026-04-11T00:00:00.000Z',
    });
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater(
        classroomRecord({
          ownerUserId: null,
          organizationId: null,
        }),
      ),
    );
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(result).toEqual({
      auth: {
        session: { id: 'web-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
      classroom: classroomRecord(),
    });
  });

  it('fails closed for web sessions when legacy ownership metadata cannot be recovered', async () => {
    readClassroomMock.mockResolvedValue(
      classroomRecord({
        ownerUserId: null,
        organizationId: null,
      }),
    );
    getRequestAuthMock.mockResolvedValue({
      session: { id: 'web-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(403);
  });
});
