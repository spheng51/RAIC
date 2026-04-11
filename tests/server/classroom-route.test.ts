import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const persistClassroomMock = vi.fn();
const buildRequestOriginMock = vi.fn(() => 'https://app.example.com');
const readClassroomMock = vi.fn();
const requireClassroomAccessMock = vi.fn();

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
    persistClassroomMock.mockReset();
    readClassroomMock.mockReset();
    buildRequestOriginMock.mockClear();
    persistClassroomMock.mockResolvedValue({
      id: 'safe-id',
      url: 'https://app.example.com/classroom/safe-id',
      stage: { id: 'safe-id' },
      scenes: [],
      createdAt: new Date().toISOString(),
    });
  });

  it('accepts valid caller-provided classroom IDs', async () => {
    const { POST } = await import('@/app/api/classroom/route');
    const request = new NextRequest('http://localhost/api/classroom', {
      method: 'POST',
      body: JSON.stringify({
        stage: { id: 'safe-id', name: 'Test classroom' },
        scenes: [],
      }),
    });

    const response = await POST(request);
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(persistClassroomMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'safe-id',
        stage: expect.objectContaining({ id: 'safe-id' }),
      }),
      'https://app.example.com',
    );
    expect(json.id).toBe('safe-id');
  });

  it('rejects invalid caller-provided classroom IDs', async () => {
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

    expect(response.status).toBe(400);
    expect(json.error).toBe('Invalid classroom id');
    expect(persistClassroomMock).not.toHaveBeenCalled();
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
      stage: { id: 'safe-id', name: 'Test classroom' },
      scenes: [],
      createdAt: new Date().toISOString(),
    });

    const request = new NextRequest('http://localhost/api/classroom?id=safe-id');
    const response = await GET(request);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(json.classroom.id).toBe('safe-id');
    expect(readClassroomMock).toHaveBeenCalledWith('safe-id');
  });
});
