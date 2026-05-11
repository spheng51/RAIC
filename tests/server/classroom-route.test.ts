import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const persistClassroomMock = vi.fn();
const buildRequestOriginMock = vi.fn(() => 'https://app.example.com');
const readClassroomMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const requireRequestRoleMock = vi.fn();
const recordAuditEventMock = vi.fn();
const resolveSessionFromTokenMock = vi.fn();
const randomUUIDMock = vi.fn(() => '11111111-1111-4111-8111-111111111111');

vi.mock('crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('crypto')>();
  return {
    ...actual,
    randomUUID: randomUUIDMock,
  };
});

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    buildRequestOrigin: buildRequestOriginMock,
    persistClassroom: persistClassroomMock,
    readClassroom: readClassroomMock,
  };
});

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/auth/session', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/auth/session')>();
  return {
    ...actual,
    resolveSessionFromToken: resolveSessionFromTokenMock,
  };
});

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('POST /api/classroom', () => {
  beforeEach(() => {
    requireClassroomAccessMock.mockReset();
    requireRequestRoleMock.mockReset();
    persistClassroomMock.mockReset();
    readClassroomMock.mockReset();
    randomUUIDMock.mockReset();
    randomUUIDMock.mockReturnValue('11111111-1111-4111-8111-111111111111');
    buildRequestOriginMock.mockClear();
    persistClassroomMock.mockImplementation(async (record, baseUrl) => ({
      id: record.id,
      url: `${baseUrl}/classroom/${record.id}`,
      stage: record.stage,
      scenes: record.scenes,
      createdAt: new Date().toISOString(),
    }));
    recordAuditEventMock.mockReset();
    resolveSessionFromTokenMock.mockReset();
  });

  it('issues a server classroom ID and rewrites the stage ID before persisting', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'web', role: 'teacher', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    });

    const { POST } = await import('@/app/api/classroom/route');
    const request = new NextRequest('http://localhost/api/classroom', {
      method: 'POST',
      body: JSON.stringify({
        stage: {
          id: 'safe-id',
          name: 'Test classroom',
          agentIds: ['default-1'],
          generatedAgentConfigs: [
            {
              id: 'gen-server-1',
              name: 'Generated Teacher',
              role: 'teacher',
              persona: 'Guides the class',
              avatar: '/avatars/teacher.png',
              color: '#123456',
              priority: 10,
            },
          ],
          sharedSimulation: {
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
            runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1',
            reportUrl: 'https://mirofish.example/report/report-1?embed=1',
            activeSurface: 'lesson',
            controllerRole: 'teacher',
            status: 'attached',
          },
        },
        scenes: [],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(persistClassroomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
          agentIds: ['default-1'],
          generatedAgentConfigs: [expect.objectContaining({ id: 'gen-server-1' })],
          sharedSimulation: expect.objectContaining({
            provider: 'mirofish',
            simulationId: 'sim-1',
            reportId: 'report-1',
          }),
        }),
      }),
      'https://app.example.com',
    );
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.created',
        resourceId: '11111111-1111-4111-8111-111111111111',
        actorRole: 'teacher',
      }),
    );
    expect(json.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(json.url).toBe('https://app.example.com/classroom/11111111-1111-4111-8111-111111111111');
  });

  it('rejects POST when auth is missing', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        { status: 401 },
      ),
    );

    const { POST } = await import('@/app/api/classroom/route');
    const request = new NextRequest('http://localhost/api/classroom', {
      method: 'POST',
      body: JSON.stringify({
        stage: { id: 'safe-id', name: 'Test classroom' },
        scenes: [],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
    expect(persistClassroomMock).not.toHaveBeenCalled();
  });

  it('rejects POST when user lacks permission', async () => {
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

    const { POST } = await import('@/app/api/classroom/route');
    const request = new NextRequest('http://localhost/api/classroom', {
      method: 'POST',
      body: JSON.stringify({
        stage: { id: 'safe-id', name: 'Test classroom' },
        scenes: [],
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(403);
    expect(persistClassroomMock).not.toHaveBeenCalled();
  });

  it('ignores invalid caller-provided classroom IDs and uses a server-issued ID', async () => {
    requireRequestRoleMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'web', role: 'teacher' },
      user: { id: 'teacher-1' },
    });

    const { POST } = await import('@/app/api/classroom/route');
    const request = new NextRequest('http://localhost/api/classroom', {
      method: 'POST',
      body: JSON.stringify({
        stage: { id: '../../escape', name: 'Bad classroom' },
        scenes: [],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(json.id).toBe('11111111-1111-4111-8111-111111111111');
    expect(persistClassroomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '11111111-1111-4111-8111-111111111111',
        stage: expect.objectContaining({
          id: '11111111-1111-4111-8111-111111111111',
        }),
      }),
      'https://app.example.com',
    );
  });

  it('rejects GET access when classroom authorization fails', async () => {
    const { GET } = await import('@/app/api/classroom/route');
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

    const request = new NextRequest('http://localhost/api/classroom?id=safe-id');
    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(readClassroomMock).not.toHaveBeenCalled();
  });

  it('returns a classroom payload when access is authorized', async () => {
    const { GET } = await import('@/app/api/classroom/route');
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'session-1', kind: 'classroom', classroomId: 'safe-id', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
    readClassroomMock.mockResolvedValue({
      id: 'safe-id',
      stage: {
        id: 'safe-id',
        name: 'Test classroom',
        sharedSimulation: {
          provider: 'mirofish',
          simulationId: 'sim-1',
          reportId: 'report-1',
          runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1',
          reportUrl: 'https://mirofish.example/report/report-1?embed=1',
          activeSurface: 'lesson',
          controllerRole: 'teacher',
          status: 'attached',
        },
      },
      scenes: [],
      createdAt: new Date().toISOString(),
    });

    const request = new NextRequest('http://localhost/api/classroom?id=safe-id');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.classroom.id).toBe('safe-id');
    expect(json.classroom.stage.sharedSimulation).toEqual(
      expect.objectContaining({
        simulationId: 'sim-1',
        reportId: 'report-1',
      }),
    );
    expect(readClassroomMock).toHaveBeenCalledWith('safe-id');
    expect(response.cookies.get('raic_session')).toBeUndefined();
  });

  it('refreshes the web session cookie when classroom access is sourced from the web session', async () => {
    const { GET } = await import('@/app/api/classroom/route');
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'session-1', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    resolveSessionFromTokenMock.mockResolvedValue({
      id: 'session-1',
      kind: 'web',
      expiresAt: '2026-01-01T00:00:00.000Z',
    });
    readClassroomMock.mockResolvedValue({
      id: 'safe-id',
      stage: { id: 'safe-id', name: 'Test classroom' },
      scenes: [],
      createdAt: new Date().toISOString(),
    });

    const request = new NextRequest('http://localhost/api/classroom?id=safe-id', {
      headers: {
        cookie: 'raic_session=session-token',
      },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
    expect(response.cookies.get('raic_session')?.value).toBe('session-token');
  });
});
