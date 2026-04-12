import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const readClassroomMock = vi.fn();
const updateClassroomMock = vi.fn();
const validateMiroFishSimulationMock = vi.fn();
const validateMiroFishReportMock = vi.fn();
const buildMiroFishRunUrlMock = vi.fn();
const buildMiroFishReportUrlMock = vi.fn();
const recordAuditEventMock = vi.fn();

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
    readClassroom: readClassroomMock,
    updateClassroom: updateClassroomMock,
  };
});

vi.mock('@/lib/server/mirofish', () => ({
  validateMiroFishSimulation: validateMiroFishSimulationMock,
  validateMiroFishReport: validateMiroFishReportMock,
  buildMiroFishRunUrl: buildMiroFishRunUrlMock,
  buildMiroFishReportUrl: buildMiroFishReportUrlMock,
}));

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('POST /api/classroom/[id]/mirofish/attach', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', role: 'teacher', kind: 'web', organizationId: 'org-1' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
      classroom: {
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: { id: 'room-1' },
        scenes: [],
        createdAt: '2026-04-11T00:00:00.000Z',
      },
    });
    readClassroomMock.mockReset();
    updateClassroomMock.mockReset();
    validateMiroFishSimulationMock.mockReset();
    validateMiroFishReportMock.mockReset();
    buildMiroFishRunUrlMock.mockReset();
    buildMiroFishReportUrlMock.mockReset();
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web' },
      user: { id: 'teacher-1' },
    });
    recordAuditEventMock.mockReset();
  });

  it('requires simulationId', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: { id: 'room-1' },
      scenes: [],
      createdAt: '2026-04-11T00:00:00.000Z',
    });

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('simulationId is required');
  });

  it('requires teacher access before attaching', async () => {
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

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({ simulationId: 'sim-1' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
    expect(readClassroomMock).not.toHaveBeenCalled();
    expect(updateClassroomMock).not.toHaveBeenCalled();
  });

  it('rejects non-owning teachers before reading the classroom', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web' },
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

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({ simulationId: 'sim-1' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(readClassroomMock).not.toHaveBeenCalled();
    expect(updateClassroomMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the classroom does not exist', async () => {
    readClassroomMock.mockResolvedValue(null);

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({ simulationId: 'sim-1' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('Classroom not found');
  });

  it('returns 400 when MiroFish validation rejects the IDs', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: { id: 'room-1' },
      scenes: [],
      createdAt: '2026-04-11T00:00:00.000Z',
    });
    validateMiroFishSimulationMock.mockRejectedValue(new Error('Simulation not found'));

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({ simulationId: 'sim-1' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Simulation not found');
  });

  it('returns 500 when the MiroFish integration is misconfigured', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: { id: 'room-1' },
      scenes: [],
      createdAt: '2026-04-11T00:00:00.000Z',
    });
    validateMiroFishSimulationMock.mockRejectedValue(new Error('MIROFISH_API_KEY is missing'));

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({ simulationId: 'sim-1' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(500);
    expect(json.error).toBe('MiroFish integration is not configured correctly');
  });

  it('persists the attached sharedSimulation on success', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: { id: 'room-1' },
      scenes: [],
      createdAt: '2026-04-11T00:00:00.000Z',
    });
    validateMiroFishSimulationMock.mockResolvedValue(undefined);
    validateMiroFishReportMock.mockResolvedValue(undefined);
    buildMiroFishRunUrlMock.mockReturnValue('https://mirofish.example.com/run/sim-1');
    buildMiroFishReportUrlMock.mockReturnValue('https://mirofish.example.com/report/report-1');
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: { id: 'room-1' },
      }),
    );

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({
          simulationId: 'sim-1',
          reportId: 'report-1',
          defaultSurface: 'simulation',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(validateMiroFishSimulationMock).toHaveBeenCalledWith('sim-1');
    expect(validateMiroFishReportMock).toHaveBeenCalledWith('report-1');
    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.attached',
        resourceId: 'room-1',
        actorRole: 'teacher',
        metadata: expect.objectContaining({
          simulationId: 'sim-1',
          reportId: 'report-1',
          defaultSurface: 'simulation',
        }),
      }),
    );
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        activeSurface: 'simulation',
        controllerRole: 'teacher',
        status: 'attached',
        runUrl: 'https://mirofish.example.com/run/sim-1',
        reportUrl: 'https://mirofish.example.com/report/report-1',
      }),
    );
  });

  it('records an update audit event when replacing an existing attachment', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: {
        id: 'room-1',
        sharedSimulation: {
          provider: 'mirofish',
          simulationId: 'sim-old',
          activeSurface: 'lesson',
          controllerRole: 'teacher',
          status: 'attached',
          runUrl: 'https://mirofish.example.com/run/sim-old',
        },
      },
      scenes: [],
      createdAt: '2026-04-11T00:00:00.000Z',
    });
    validateMiroFishSimulationMock.mockResolvedValue(undefined);
    buildMiroFishRunUrlMock.mockReturnValue('https://mirofish.example.com/run/sim-2');
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        stage: {
          id: 'room-1',
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-old',
            activeSurface: 'lesson',
            controllerRole: 'teacher',
            status: 'attached',
            runUrl: 'https://mirofish.example.com/run/sim-old',
          },
        },
      }),
    );

    const { POST } = await import('@/app/api/classroom/[id]/mirofish/attach/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/mirofish/attach', {
        method: 'POST',
        body: JSON.stringify({
          simulationId: 'sim-2',
          defaultSurface: 'lesson',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.updated',
        resourceId: 'room-1',
        metadata: expect.objectContaining({
          simulationId: 'sim-2',
          actorSessionId: 'teacher-session',
        }),
      }),
    );
  });
});
