import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomCollaborationSnapshotMock = vi.fn();
const buildClassroomCollaborationStatePayloadMock = vi.fn();
const updateClassroomMock = vi.fn();
const isMiroFishMultiUserEnabledMock = vi.fn();
const issueMiroFishParticipantTokenMock = vi.fn();
const withMiroFishParticipantTokenMock = vi.fn();
const recordClassroomRoomEventMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-collaboration', () => ({
  getClassroomCollaborationSnapshot: getClassroomCollaborationSnapshotMock,
  buildClassroomCollaborationStatePayload: buildClassroomCollaborationStatePayloadMock,
  canSessionModerateCollaboration: (session: { kind: string; role: string }) =>
    session.kind === 'web' && session.role !== 'student',
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    updateClassroom: updateClassroomMock,
  };
});

vi.mock('@/lib/server/mirofish', () => ({
  isMiroFishMultiUserEnabled: isMiroFishMultiUserEnabledMock,
  issueMiroFishParticipantToken: issueMiroFishParticipantTokenMock,
  withMiroFishParticipantToken: withMiroFishParticipantTokenMock,
}));

vi.mock('@/lib/server/classroom-room-events', () => ({
  buildClassroomRoomEventActor: (input: unknown) => input,
  recordClassroomRoomEvent: recordClassroomRoomEventMock,
}));

describe('POST /api/classroom/[id]/mirofish/session', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomCollaborationSnapshotMock.mockReset();
    buildClassroomCollaborationStatePayloadMock.mockReset();
    updateClassroomMock.mockReset();
    isMiroFishMultiUserEnabledMock.mockReset();
    issueMiroFishParticipantTokenMock.mockReset();
    withMiroFishParticipantTokenMock.mockReset();
    recordClassroomRoomEventMock.mockReset();
    isMiroFishMultiUserEnabledMock.mockReturnValue(true);
  });

  it('rejects classroom access failures directly', async () => {
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

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/session', {
        method: 'POST',
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(401);
    expect(getClassroomCollaborationSnapshotMock).not.toHaveBeenCalled();
  });

  it('creates or resumes a shared multi-user session and returns a viewer embed URL', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1', displayName: 'Student One' },
      },
      source: 'classroom',
    });
    getClassroomCollaborationSnapshotMock.mockResolvedValue({
      classroom: { roomVersion: 0 },
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        runUrl: 'https://mirofish.example/run',
        reportUrl: 'https://mirofish.example/report',
        activeSurface: 'simulation',
        controllerRole: 'teacher',
        collaborationMode: 'multi-user',
        collaborationState: 'inactive',
        allowStudentInteraction: true,
        status: 'running',
      },
      participants: [],
    });
    buildClassroomCollaborationStatePayloadMock.mockReturnValue({
      viewerCanInteract: true,
    });
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        roomVersion: 1,
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
            runUrl: 'https://mirofish.example/run',
            reportUrl: 'https://mirofish.example/report',
            activeSurface: 'simulation',
            controllerRole: 'teacher',
            collaborationMode: 'multi-user',
            collaborationState: 'inactive',
            allowStudentInteraction: true,
            status: 'running',
          },
        },
      }),
    );
    issueMiroFishParticipantTokenMock.mockReturnValue({
      token: 'participant-token',
      expiresAt: '2026-04-11T02:00:00.000Z',
    });
    withMiroFishParticipantTokenMock.mockReturnValue(
      'https://mirofish.example/run?embed=1&participantToken=participant-token',
    );

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/session', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(issueMiroFishParticipantTokenMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        simulationId: 'sim-1',
        sessionId: 'student-session',
        capabilities: ['view', 'interact'],
      }),
    );
    expect(json).toEqual(
      expect.objectContaining({
        success: true,
        collaborationMode: 'multi-user',
        embedUrl: 'https://mirofish.example/run?embed=1&participantToken=participant-token',
        tokenExpiresAt: '2026-04-11T02:00:00.000Z',
      }),
    );
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        roomVersion: 1,
        kind: 'mirofish.session.updated',
      }),
    );
  });
});
