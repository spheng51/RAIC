import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const getClassroomPresentationSnapshotMock = vi.fn();
const resetSharedSimulationControlMock = vi.fn();
const updateClassroomMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/classroom-presentation', () => ({
  getClassroomPresentationSnapshot: getClassroomPresentationSnapshotMock,
  resetSharedSimulationControl: resetSharedSimulationControlMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    updateClassroom: updateClassroomMock,
  };
});

describe('PATCH /api/classroom/[id]/control', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    getClassroomPresentationSnapshotMock.mockReset();
    resetSharedSimulationControlMock.mockReset();
    updateClassroomMock.mockReset();
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

    const { PATCH } = await import('@/app/api/classroom/[id]/control/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/control', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'revoke' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(getClassroomPresentationSnapshotMock).not.toHaveBeenCalled();
  });

  it('rejects invalid control actions', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web' },
      user: { id: 'teacher-1' },
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      participants: [],
    });

    const { PATCH } = await import('@/app/api/classroom/[id]/control/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/control', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'pause' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid action');
  });

  it('rejects grants when targetSessionId is not an active participant', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web' },
      user: { id: 'teacher-1' },
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      participants: [],
    });
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            activeSurface: 'lesson',
            controllerRole: 'teacher',
            status: 'attached',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/control/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/control', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'grant', targetSessionId: 'missing-session' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('targetSessionId must match an active classroom session');
  });

  it('resets control back to the teacher on revoke', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web' },
      user: { id: 'teacher-1' },
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'simulation',
        controllerSessionId: 'student-session',
        controllerRole: 'student',
        controlLeaseExpiresAt: '2026-04-12T00:00:00.000Z',
        status: 'running',
      },
      participants: [],
    });
    resetSharedSimulationControlMock.mockReturnValue({
      provider: 'mirofish',
      simulationId: 'sim-1',
      activeSurface: 'simulation',
      controllerRole: 'teacher',
      status: 'running',
    });
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            activeSurface: 'simulation',
            controllerSessionId: 'student-session',
            controllerRole: 'student',
            controlLeaseExpiresAt: '2026-04-12T00:00:00.000Z',
            status: 'running',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/control/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/control', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'revoke' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(resetSharedSimulationControlMock).toHaveBeenCalled();
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        controllerRole: 'teacher',
      }),
    );
  });
});
