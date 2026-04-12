import path from 'node:path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
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

  afterEach(async () => {
    await fs.rm(path.join(process.cwd(), 'data', 'classrooms'), {
      recursive: true,
      force: true,
    });
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

  it('marks authorized classroom media as private and non-cacheable', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', classroomId: 'room-1', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
      classroom: {
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: { id: 'room-1' },
        scenes: [],
        createdAt: '2026-04-11T00:00:00.000Z',
      },
    });

    const mediaDir = path.join(process.cwd(), 'data', 'classrooms', 'room-1', 'media');
    await fs.mkdir(mediaDir, { recursive: true });
    await fs.writeFile(path.join(mediaDir, 'asset.png'), 'stub');

    const { GET } = await import('@/app/api/classroom-media/[classroomId]/[...path]/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom-media/room-1/media/asset.png'), {
      params: Promise.resolve({
        classroomId: 'room-1',
        path: ['media', 'asset.png'],
      }),
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
  });
});
