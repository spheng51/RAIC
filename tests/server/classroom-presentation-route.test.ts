import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomPresentationSnapshotMock = vi.fn();
const canSessionControlPresentationMock = vi.fn();
const updateClassroomMock = vi.fn();
const recordAuditEventMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-presentation', () => ({
  getClassroomPresentationSnapshot: getClassroomPresentationSnapshotMock,
  canSessionControlPresentation: canSessionControlPresentationMock,
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

describe('PATCH /api/classroom/[id]/presentation', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomPresentationSnapshotMock.mockReset();
    canSessionControlPresentationMock.mockReset();
    updateClassroomMock.mockReset();
    recordAuditEventMock.mockReset();
  });

  it('rejects invalid activeSurface values', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      reportAvailable: false,
    });
    canSessionControlPresentationMock.mockReturnValue(true);

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ activeSurface: 'whiteboard' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid activeSurface value');
  });

  it('rejects invalid status values', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      reportAvailable: false,
    });
    canSessionControlPresentationMock.mockReturnValue(true);

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'paused' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid status value');
  });

  it('rejects report surface when no report is attached', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      reportAvailable: false,
    });
    canSessionControlPresentationMock.mockReturnValue(true);

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ activeSurface: 'report' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('No report is attached to this classroom');
  });

  it('rejects viewers who cannot control the presentation', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      reportAvailable: false,
    });
    canSessionControlPresentationMock.mockReturnValue(false);

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ activeSurface: 'simulation' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.error).toBe(
      'Only the teacher or the active controller can change the presentation',
    );
  });

  it('allows authorized viewers to update the presentation surface and status', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'attached',
      },
      reportAvailable: true,
    });
    canSessionControlPresentationMock.mockReturnValue(true);
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
            activeSurface: 'lesson',
            controllerRole: 'teacher',
            status: 'attached',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ activeSurface: 'report', status: 'completed' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.presentation.surface_changed',
        resourceId: 'room-1',
        actorRole: 'teacher',
        metadata: expect.objectContaining({
          activeSurface: 'report',
          previousSurface: 'lesson',
          status: 'completed',
          previousStatus: 'attached',
          actorSessionId: 'teacher-session',
          actorKind: 'web',
        }),
      }),
    );
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        activeSurface: 'report',
        status: 'completed',
      }),
    );
  });

  it('records recovery-to-lesson when a simulation error falls back the classroom view', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        activeSurface: 'simulation',
        controllerRole: 'teacher',
        status: 'running',
      },
      reportAvailable: true,
    });
    canSessionControlPresentationMock.mockReturnValue(true);
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
            activeSurface: 'simulation',
            controllerRole: 'teacher',
            status: 'running',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ activeSurface: 'lesson', status: 'error' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.presentation.recovered_to_lesson',
        resourceId: 'room-1',
        metadata: expect.objectContaining({
          activeSurface: 'lesson',
          previousSurface: 'simulation',
          status: 'error',
          previousStatus: 'running',
          actorSessionId: 'teacher-session',
        }),
      }),
    );
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        activeSurface: 'lesson',
        status: 'error',
      }),
    );
  });

  it('rejects stale classroom-controller updates that lose authority before the write commits', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        activeSurface: 'simulation',
        controllerSessionId: 'student-session',
        controllerRole: 'student',
        controlLeaseExpiresAt: '2026-04-17T00:10:00.000Z',
        status: 'running',
      },
      reportAvailable: false,
    });
    canSessionControlPresentationMock.mockReturnValueOnce(true).mockReturnValueOnce(false);
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            activeSurface: 'simulation',
            controllerRole: 'teacher',
            status: 'running',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'running' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe('Presentation control changed before the update was applied');
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('preserves a newer surface when a concurrent status-only update commits', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        activeSurface: 'simulation',
        controllerRole: 'teacher',
        status: 'running',
      },
      reportAvailable: true,
    });
    canSessionControlPresentationMock.mockReturnValue(true);
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
            activeSurface: 'report',
            controllerRole: 'teacher',
            status: 'running',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ status: 'completed' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        activeSurface: 'report',
        status: 'completed',
      }),
    );
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('preserves a newer status when a concurrent surface-only update commits', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        activeSurface: 'lesson',
        controllerRole: 'teacher',
        status: 'running',
      },
      reportAvailable: true,
    });
    canSessionControlPresentationMock.mockReturnValue(true);
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
            activeSurface: 'lesson',
            controllerRole: 'teacher',
            status: 'completed',
          },
        },
      }),
    );

    const { PATCH } = await import('@/app/api/classroom/[id]/presentation/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/presentation', {
        method: 'PATCH',
        body: JSON.stringify({ activeSurface: 'report' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        activeSurface: 'report',
        status: 'completed',
      }),
    );
  });
});
