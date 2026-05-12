import { describe, expect, it, beforeEach, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const listAccessibleClassroomSummariesMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  listAccessibleClassroomSummaries: listAccessibleClassroomSummariesMock,
}));

describe('GET /api/classrooms', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    listAccessibleClassroomSummariesMock.mockReset();
  });

  it('returns accessible classroom summaries for the current teacher', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'teacher',
        organizationId: 'org-1',
      },
      user: { id: 'teacher-1' },
    });
    listAccessibleClassroomSummariesMock.mockResolvedValue([
      {
        id: 'room-1',
        name: 'Physics demo',
        sceneCount: 2,
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T01:00:00.000Z',
      },
    ]);

    const { GET } = await import('@/app/api/classrooms/route');
    const response = await GET(new NextRequest('http://localhost/api/classrooms'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listAccessibleClassroomSummariesMock).toHaveBeenCalledWith({
      role: 'teacher',
      userId: 'teacher-1',
      organizationId: 'org-1',
    });
    expect(json.classrooms).toHaveLength(1);
    expect(json.classrooms[0].name).toBe('Physics demo');
  });

  it('passes org-admin scope through to classroom storage', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'org_admin',
        organizationId: 'org-admin-1',
      },
      user: { id: 'org-admin-1' },
    });
    listAccessibleClassroomSummariesMock.mockResolvedValue([]);

    const { GET } = await import('@/app/api/classrooms/route');
    const response = await GET(new NextRequest('http://localhost/api/classrooms'));

    expect(response.status).toBe(200);
    expect(listAccessibleClassroomSummariesMock).toHaveBeenCalledWith({
      role: 'org_admin',
      userId: 'org-admin-1',
      organizationId: 'org-admin-1',
    });
  });

  it('passes system-admin scope through to classroom storage', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: {
        role: 'system_admin',
        organizationId: null,
      },
      user: { id: 'system-admin-1' },
    });
    listAccessibleClassroomSummariesMock.mockResolvedValue([]);

    const { GET } = await import('@/app/api/classrooms/route');
    const response = await GET(new NextRequest('http://localhost/api/classrooms'));

    expect(response.status).toBe(200);
    expect(listAccessibleClassroomSummariesMock).toHaveBeenCalledWith({
      role: 'system_admin',
      userId: 'system-admin-1',
      organizationId: null,
    });
  });

  it('requires teacher access', async () => {
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

    const { GET } = await import('@/app/api/classrooms/route');
    const response = await GET(new NextRequest('http://localhost/api/classrooms'));

    expect(response.status).toBe(401);
    expect(listAccessibleClassroomSummariesMock).not.toHaveBeenCalled();
  });
});
