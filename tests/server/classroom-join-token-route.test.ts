import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const createJoinTokenRecordMock = vi.fn();
const buildRequestOriginMock = vi.fn(() => 'https://app.example.com');
const recordAuditEventMock = vi.fn();
const createOpaqueTokenMock = vi.fn(() => 'raw-join-token');
const hashTokenMock = vi.fn(() => 'hashed-token');

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    buildRequestOrigin: buildRequestOriginMock,
  };
});

vi.mock('@/lib/db/repositories/join-tokens', () => ({
  createJoinTokenRecord: createJoinTokenRecordMock,
}));

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    createOpaqueToken: createOpaqueTokenMock,
    hashToken: hashTokenMock,
  };
});

describe('POST /api/classroom/join-token', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: {
          id: 'session-1',
          kind: 'web',
          role: 'teacher',
          organizationId: 'org-1',
        },
        user: { id: 'teacher-1' },
      },
      source: 'web',
      classroom: {
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: { id: 'room-1' },
        scenes: [],
        createdAt: new Date().toISOString(),
      },
    });
    createJoinTokenRecordMock.mockReset();
    recordAuditEventMock.mockReset();
    createOpaqueTokenMock.mockClear();
    hashTokenMock.mockClear();
    buildRequestOriginMock.mockClear();
  });

  it('creates a join token for a teacher', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        id: 'session-1',
        kind: 'web',
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });

    createJoinTokenRecordMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      createdByUserId: 'teacher-1',
      organizationId: 'org-1',
      displayName: 'Physics 101',
      tokenHash: 'hashed-token',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
      consumedAt: null,
    });

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({
          classroomId: 'room-1',
          displayName: 'Physics 101',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(createOpaqueTokenMock).toHaveBeenCalledTimes(1);
    expect(requireClassroomAccessMock).toHaveBeenCalledWith(expect.any(NextRequest), 'room-1');
    expect(hashTokenMock).toHaveBeenCalledWith('raw-join-token');
    expect(buildRequestOriginMock).toHaveBeenCalled();
    expect(createJoinTokenRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        createdByUserId: 'teacher-1',
        organizationId: 'org-1',
        displayName: 'Physics 101',
        tokenHash: 'hashed-token',
      }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.join_token.created',
        resourceId: 'room-1',
        metadata: expect.objectContaining({
          displayName: 'Physics 101',
        }),
      }),
    );
    expect(json.joinUrl).toBe('https://app.example.com/join/raw-join-token');
  });

  it('rejects missing classroom token generation auth', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        { status: 401 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({ classroomId: 'room-1' }),
      }),
    );

    expect(response.status).toBe(401);
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
    expect(createJoinTokenRecordMock).not.toHaveBeenCalled();
  });

  it('rejects non-teacher callers', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'FORBIDDEN',
          error: 'You do not have permission to perform this action',
        },
        { status: 403 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({ classroomId: 'room-1' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
    expect(createJoinTokenRecordMock).not.toHaveBeenCalled();
  });

  it('rejects invalid classroom IDs', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        id: 'session-1',
        kind: 'web',
        role: 'teacher',
      },
      user: { id: 'teacher-1' },
    });

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({ classroomId: '../../escape' }),
      }),
    );

    const json = await response.json();
    expect(response.status).toBe(400);
    expect(json.error).toBe('A valid classroomId is required');
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
    expect(createJoinTokenRecordMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the classroom does not exist', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        id: 'session-1',
        kind: 'web',
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'INVALID_REQUEST',
          error: 'Classroom not found',
        },
        { status: 404 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({ classroomId: 'room-1' }),
      }),
    );

    expect(response.status).toBe(404);
    expect(createJoinTokenRecordMock).not.toHaveBeenCalled();
  });

  it('returns 403 when the teacher does not own the classroom', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        id: 'session-1',
        kind: 'web',
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-2' },
    });
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'FORBIDDEN',
          error: 'You do not have permission to access this classroom',
        },
        { status: 403 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({ classroomId: 'room-1' }),
      }),
    );

    expect(response.status).toBe(403);
    expect(createJoinTokenRecordMock).not.toHaveBeenCalled();
  });

  it('allows same-org org admins to mint join tokens', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        id: 'session-1',
        kind: 'web',
        role: 'org_admin',
        organizationId: 'org-1',
      },
      user: { id: 'admin-1' },
    });
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: {
          id: 'session-1',
          kind: 'web',
          role: 'org_admin',
          organizationId: 'org-1',
        },
        user: { id: 'admin-1' },
      },
      source: 'web',
      classroom: {
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: { id: 'room-1' },
        scenes: [],
        createdAt: new Date().toISOString(),
      },
    });
    createJoinTokenRecordMock.mockResolvedValue({
      id: 'join-1',
      classroomId: 'room-1',
      createdByUserId: 'admin-1',
      organizationId: 'org-1',
      displayName: 'Physics 101',
      tokenHash: 'hashed-token',
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + 120 * 60 * 1000).toISOString(),
      consumedAt: null,
    });

    const { POST } = await import('@/app/api/classroom/join-token/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/join-token', {
        method: 'POST',
        body: JSON.stringify({
          classroomId: 'room-1',
          displayName: 'Physics 101',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(createJoinTokenRecordMock).toHaveBeenCalledWith(
      expect.objectContaining({
        createdByUserId: 'admin-1',
      }),
    );
  });
});
