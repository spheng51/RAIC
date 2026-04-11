import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireRequestRoleMock = vi.fn();
const readClassroomMock = vi.fn();
const updateClassroomMock = vi.fn();
const validateMiroFishSimulationMock = vi.fn();
const validateMiroFishReportMock = vi.fn();
const buildMiroFishRunUrlMock = vi.fn();
const buildMiroFishReportUrlMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
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

describe('POST /api/classroom/[id]/mirofish/attach', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
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
});
