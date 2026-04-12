import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomCollaborationSnapshotMock = vi.fn();
const buildClassroomCollaborationStatePayloadMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-collaboration', () => ({
  getClassroomCollaborationSnapshot: getClassroomCollaborationSnapshotMock,
  buildClassroomCollaborationStatePayload: buildClassroomCollaborationStatePayloadMock,
}));

describe('GET /api/classroom/[id]/collaboration-state', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomCollaborationSnapshotMock.mockReset();
    buildClassroomCollaborationStatePayloadMock.mockReset();
  });

  it('returns classroom access failures directly', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Classroom access required',
        },
        { status: 401 },
      ),
    );

    const { GET } = await import('@/app/api/classroom/[id]/collaboration-state/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration-state'),
      {
        params: Promise.resolve({ id: 'room-1' }),
      },
    );

    expect(response.status).toBe(401);
    expect(getClassroomCollaborationSnapshotMock).not.toHaveBeenCalled();
  });

  it('returns the collaboration payload for authorized classroom viewers', async () => {
    const payload = {
      collaborationMode: 'multi-user',
      collaborationState: 'live',
      allowStudentInteraction: true,
      spotlightSessionId: null,
      participantCount: 2,
      participants: [],
      mirofishSessionId: 'miro-session-1',
      lastCollaborationSyncAt: '2026-04-11T00:00:00.000Z',
      viewerSessionId: 'student-session',
      viewerRole: 'student',
      viewerKind: 'classroom',
      viewerCanModerateCollaboration: false,
      viewerCanInteract: true,
      viewerIsRemoved: false,
      viewerInteractionReason: null,
      multiUserEnabled: true,
    };

    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
    getClassroomCollaborationSnapshotMock.mockResolvedValue({ id: 'snapshot-1' });
    buildClassroomCollaborationStatePayloadMock.mockReturnValue(payload);

    const { GET } = await import('@/app/api/classroom/[id]/collaboration-state/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration-state'),
      {
        params: Promise.resolve({ id: 'room-1' }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toEqual(
      expect.objectContaining({
        success: true,
        collaborationMode: 'multi-user',
        participantCount: 2,
        viewerCanInteract: true,
      }),
    );
  });
});
