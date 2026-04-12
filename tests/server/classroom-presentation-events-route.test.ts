import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomPresentationSnapshotMock = vi.fn();
const buildClassroomPresentationStatePayloadMock = vi.fn();
const getClassroomPresentationFingerprintMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-presentation', () => ({
  getClassroomPresentationSnapshot: getClassroomPresentationSnapshotMock,
  buildClassroomPresentationStatePayload: buildClassroomPresentationStatePayloadMock,
  getClassroomPresentationFingerprint: getClassroomPresentationFingerprintMock,
}));

describe('GET /api/classroom/[id]/presentation-events', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomPresentationSnapshotMock.mockReset();
    buildClassroomPresentationStatePayloadMock.mockReset();
    getClassroomPresentationFingerprintMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams the initial presentation snapshot for teacher viewers', async () => {
    const abortController = new AbortController();
    const payload = {
      activeSurface: 'simulation',
      controllerSessionId: null,
      controllerRole: 'teacher',
      controlLeaseExpiresAt: null,
      simulationStatus: 'running',
      reportAvailable: true,
      sharedSimulation: null,
      runUrl: 'https://mirofish.example/run',
      reportUrl: 'https://mirofish.example/report',
      viewerSessionId: 'teacher-session',
      viewerRole: 'teacher',
      viewerKind: 'web',
      viewerCanManageSimulation: true,
      viewerCanControlPresentation: true,
      viewerHasSimulationControl: true,
      participants: [],
    };

    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({ id: 'snapshot-1' });
    buildClassroomPresentationStatePayloadMock.mockReturnValue(payload);
    getClassroomPresentationFingerprintMock.mockReturnValue('fp-1');

    const { GET } = await import('@/app/api/classroom/[id]/presentation-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/presentation-events', {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);

    expect(text).toContain('event: presentation-state');
    expect(text).toContain(`data: ${JSON.stringify(payload)}`);

    abortController.abort();
    await reader!.cancel();
  });

  it('streams the initial presentation snapshot for classroom student viewers', async () => {
    const abortController = new AbortController();
    const payload = {
      activeSurface: 'lesson',
      controllerSessionId: 'student-session',
      controllerRole: 'student',
      controlLeaseExpiresAt: '2026-04-11T00:10:00.000Z',
      simulationStatus: 'running',
      reportAvailable: false,
      sharedSimulation: null,
      runUrl: 'https://mirofish.example/run',
      reportUrl: null,
      viewerSessionId: 'student-session',
      viewerRole: 'student',
      viewerKind: 'classroom',
      viewerCanManageSimulation: false,
      viewerCanControlPresentation: true,
      viewerHasSimulationControl: true,
      participants: [],
    };

    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue({ id: 'snapshot-1' });
    buildClassroomPresentationStatePayloadMock.mockReturnValue(payload);
    getClassroomPresentationFingerprintMock.mockReturnValue('fp-1');

    const { GET } = await import('@/app/api/classroom/[id]/presentation-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/presentation-events', {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);

    expect(response.status).toBe(200);
    expect(text).toContain('event: presentation-state');
    expect(text).toContain(`data: ${JSON.stringify(payload)}`);

    abortController.abort();
    await reader!.cancel();
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

    const { GET } = await import('@/app/api/classroom/[id]/presentation-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/presentation-events'),
      {
        params: Promise.resolve({ id: 'room-1' }),
      },
    );

    expect(response.status).toBe(401);
    expect(getClassroomPresentationSnapshotMock).not.toHaveBeenCalled();
  });

  it('returns 404 when the classroom snapshot is missing', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomPresentationSnapshotMock.mockResolvedValue(null);

    const { GET } = await import('@/app/api/classroom/[id]/presentation-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/presentation-events'),
      {
        params: Promise.resolve({ id: 'room-1' }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('Classroom not found');
  });
});
