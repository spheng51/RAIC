import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomPresentationSnapshotMock = vi.fn();
const canSessionControlPresentationMock = vi.fn();
const doesSessionOwnSimulationControlMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-presentation', () => ({
  getClassroomPresentationSnapshot: getClassroomPresentationSnapshotMock,
  canSessionControlPresentation: canSessionControlPresentationMock,
  doesSessionOwnSimulationControl: doesSessionOwnSimulationControlMock,
}));

describe('GET /api/classroom/[id]/presentation-state', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomPresentationSnapshotMock.mockReset();
    canSessionControlPresentationMock.mockReset();
    doesSessionOwnSimulationControlMock.mockReset();
  });

  it('rejects invalid classroom IDs', async () => {
    const { GET } = await import('@/app/api/classroom/[id]/presentation-state/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/bad/presentation-state'), {
      params: Promise.resolve({ id: '../bad' }),
    });
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid classroom id');
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
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

    const { GET } = await import('@/app/api/classroom/[id]/presentation-state/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/presentation-state'), {
      params: Promise.resolve({ id: 'room-1' }),
    });

    expect(response.status).toBe(401);
    expect(getClassroomPresentationSnapshotMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the classroom presentation snapshot is missing', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'session-1', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue(null);

    const { GET } = await import('@/app/api/classroom/[id]/presentation-state/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/presentation-state'), {
      params: Promise.resolve({ id: 'room-1' }),
    });
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('Classroom not found');
  });

  it('returns viewer capabilities and resolved run/report URLs', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'session-1', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      classroom: { id: 'room-1', stage: { id: 'room-1' }, scenes: [], createdAt: '2026-04-11T00:00:00.000Z' },
      sharedSimulation: {
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        runUrl: 'https://raw.run',
        reportUrl: 'https://raw.report',
        activeSurface: 'simulation',
        controllerSessionId: 'student-session',
        controllerRole: 'student',
        controlLeaseExpiresAt: '2026-04-12T00:00:00.000Z',
        status: 'running',
      },
      participants: [
        {
          sessionId: 'student-session',
          userId: 'student-1',
          displayName: 'Student One',
          role: 'student',
          lastSeenAt: '2026-04-11T00:00:00.000Z',
          isController: true,
        },
      ],
      reportAvailable: true,
      runUrl: 'https://embedded.run',
      reportUrl: 'https://embedded.report',
    });
    canSessionControlPresentationMock.mockReturnValue(true);
    doesSessionOwnSimulationControlMock.mockReturnValue(false);

    const { GET } = await import('@/app/api/classroom/[id]/presentation-state/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/presentation-state'), {
      params: Promise.resolve({ id: 'room-1' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.viewerCanManageSimulation).toBe(true);
    expect(json.viewerCanControlPresentation).toBe(true);
    expect(json.viewerHasSimulationControl).toBe(false);
    expect(json.runUrl).toBe('https://embedded.run');
    expect(json.reportUrl).toBe('https://embedded.report');
    expect(json.sharedSimulation.runUrl).toBe('https://embedded.run');
    expect(json.sharedSimulation.reportUrl).toBe('https://embedded.report');
    expect(json.participants).toEqual([
      expect.objectContaining({
        sessionId: 'student-session',
        displayName: 'Student One',
        isController: true,
      }),
    ]);
  });

  it('marks student viewers as unable to manage the simulation', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({
      classroom: { id: 'room-1', stage: { id: 'room-1' }, scenes: [], createdAt: '2026-04-11T00:00:00.000Z' },
      sharedSimulation: null,
      participants: [],
      reportAvailable: false,
      runUrl: null,
      reportUrl: null,
    });
    canSessionControlPresentationMock.mockReturnValue(false);
    doesSessionOwnSimulationControlMock.mockReturnValue(false);

    const { GET } = await import('@/app/api/classroom/[id]/presentation-state/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/presentation-state'), {
      params: Promise.resolve({ id: 'room-1' }),
    });
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.viewerCanManageSimulation).toBe(false);
    expect(json.viewerRole).toBe('student');
    expect(json.viewerKind).toBe('classroom');
  });
});
