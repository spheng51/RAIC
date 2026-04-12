import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const getClassroomCollaborationSnapshotMock = vi.fn();
const buildClassroomCollaborationStatePayloadMock = vi.fn();
const updateClassroomMock = vi.fn();
const recordAuditEventMock = vi.fn();
const isMiroFishMultiUserEnabledMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-collaboration', () => ({
  getClassroomCollaborationSnapshot: getClassroomCollaborationSnapshotMock,
  buildClassroomCollaborationStatePayload: buildClassroomCollaborationStatePayloadMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    updateClassroom: updateClassroomMock,
  };
});

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

vi.mock('@/lib/server/mirofish', () => ({
  isMiroFishMultiUserEnabled: isMiroFishMultiUserEnabledMock,
}));

describe('PATCH /api/classroom/[id]/collaboration', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    getClassroomCollaborationSnapshotMock.mockReset();
    buildClassroomCollaborationStatePayloadMock.mockReset();
    updateClassroomMock.mockReset();
    recordAuditEventMock.mockReset();
    isMiroFishMultiUserEnabledMock.mockReset();
    isMiroFishMultiUserEnabledMock.mockReturnValue(true);
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', role: 'teacher', kind: 'web', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
  });

  it('enforces teacher-only access', async () => {
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

    const { PATCH } = await import('@/app/api/classroom/[id]/collaboration/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'freeze' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
  });

  it('freezes a live collaboration session', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    });
    getClassroomCollaborationSnapshotMock
      .mockResolvedValueOnce({
        sharedSimulation: {
          provider: 'mirofish',
          simulationId: 'sim-1',
          reportId: 'report-1',
          runUrl: 'https://mirofish.example/run',
          reportUrl: 'https://mirofish.example/report',
          activeSurface: 'simulation',
          controllerRole: 'teacher',
          collaborationMode: 'multi-user',
          collaborationState: 'live',
          allowStudentInteraction: true,
          status: 'running',
        },
        participants: [],
      })
      .mockResolvedValueOnce({
        sharedSimulation: {
          provider: 'mirofish',
          simulationId: 'sim-1',
          reportId: 'report-1',
          runUrl: 'https://mirofish.example/run',
          reportUrl: 'https://mirofish.example/report',
          activeSurface: 'simulation',
          controllerRole: 'teacher',
          collaborationMode: 'multi-user',
          collaborationState: 'frozen',
          allowStudentInteraction: false,
          status: 'running',
        },
        participants: [],
      });
    buildClassroomCollaborationStatePayloadMock.mockReturnValue({
      collaborationState: 'frozen',
    });
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
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
            collaborationState: 'live',
            allowStudentInteraction: true,
            status: 'running',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/collaboration/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'freeze' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.collaboration.freeze',
        resourceId: 'room-1',
      }),
    );
    expect(json.collaboration).toEqual(expect.objectContaining({ collaborationState: 'frozen' }));
  });
});
