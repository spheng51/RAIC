import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const readClassroomMock = vi.fn();
const updateClassroomMock = vi.fn();
const validateMiroFishSimulationMock = vi.fn();
const validateMiroFishReportMock = vi.fn();
const buildAttachedMiroFishSharedSimulationMock = vi.fn();
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
  buildAttachedMiroFishSharedSimulation: buildAttachedMiroFishSharedSimulationMock,
  isMiroFishMultiUserEnabled: () => false,
}));

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

describe('POST /api/classroom/[id]/mirofish/attach', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    readClassroomMock.mockReset();
    updateClassroomMock.mockReset();
    validateMiroFishSimulationMock.mockReset();
    validateMiroFishReportMock.mockReset();
    buildAttachedMiroFishSharedSimulationMock.mockReset();
    recordAuditEventMock.mockReset();

    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'teacher-session', role: 'teacher', kind: 'web', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    });
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
        stage: { id: 'room-1', name: 'Coral Reef Lab' },
        scenes: [],
        createdAt: '2026-04-11T00:00:00.000Z',
      },
    });
    buildAttachedMiroFishSharedSimulationMock.mockImplementation(
      ({ simulationId, reportId, defaultSurface, collaborationMode, authoring }) => ({
        provider: 'mirofish',
        simulationId,
        reportId,
        runUrl: `https://mirofish.example.com/run/${simulationId}`,
        reportUrl: reportId ? `https://mirofish.example.com/report/${reportId}` : undefined,
        authoring,
        activeSurface: defaultSurface,
        controllerRole: 'teacher',
        collaborationMode,
        collaborationState: 'inactive',
        allowStudentInteraction: collaborationMode === 'multi-user',
        status: 'attached',
      }),
    );
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

  it('persists the attached sharedSimulation on success', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      stage: { id: 'room-1' },
      scenes: [],
      createdAt: '2026-04-11T00:00:00.000Z',
    });
    validateMiroFishSimulationMock.mockResolvedValue(undefined);
    validateMiroFishReportMock.mockResolvedValue(undefined);
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: { id: 'room-1' },
        scenes: [],
        createdAt: '2026-04-11T00:00:00.000Z',
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
    expect(buildAttachedMiroFishSharedSimulationMock).toHaveBeenCalledWith(
      expect.objectContaining({
        simulationId: 'sim-1',
        reportId: 'report-1',
        defaultSurface: 'simulation',
        collaborationMode: 'single-controller',
        authoring: expect.objectContaining({
          source: 'manual-attach',
        }),
      }),
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.mirofish.attached',
        resourceId: 'room-1',
      }),
    );
    expect(json.sharedSimulation).toEqual(
      expect.objectContaining({
        provider: 'mirofish',
        simulationId: 'sim-1',
        reportId: 'report-1',
        activeSurface: 'simulation',
        status: 'attached',
        authoring: expect.objectContaining({
          source: 'manual-attach',
        }),
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
    updateClassroomMock.mockImplementation(async (_id, updater) =>
      updater({
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
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
      }),
    );
  });
});
