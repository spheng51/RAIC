import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();

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

describe('GET /api/classroom-media/[classroomId]/[...path]', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
  });

  it('requires classroom access before streaming assets', async () => {
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

    const { GET } = await import('@/app/api/classroom-media/[classroomId]/[...path]/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom-media/room-1/media/asset.png'), {
      params: Promise.resolve({
        classroomId: 'room-1',
        path: ['media', 'asset.png'],
      }),
    });

    expect(response.status).toBe(401);
  });
});
