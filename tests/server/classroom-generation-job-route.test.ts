import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const readClassroomGenerationJobMock = vi.fn();
const canAccessClassroomGenerationJobMock = vi.fn();
const buildRequestOriginMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/classroom-job-store', () => ({
  canAccessClassroomGenerationJob: canAccessClassroomGenerationJobMock,
  isValidClassroomJobId: (jobId: string) => /^[a-zA-Z0-9_-]+$/.test(jobId),
  readClassroomGenerationJob: readClassroomGenerationJobMock,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: buildRequestOriginMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  }),
}));

const authContext = {
  organization: { id: 'org-1' },
  session: { role: 'teacher' },
  user: { id: 'teacher-1' },
};

describe('GET /api/generate-classroom/[jobId]', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    readClassroomGenerationJobMock.mockReset();
    canAccessClassroomGenerationJobMock.mockReset();
    buildRequestOriginMock.mockReset();

    requireRequestRoleMock.mockResolvedValue(authContext);
    buildRequestOriginMock.mockReturnValue('http://localhost:3000');
    canAccessClassroomGenerationJobMock.mockReturnValue(true);
  });

  it('returns auth failures from requireRequestRole', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json({ errorCode: 'UNAUTHORIZED' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/generate-classroom/[jobId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/generate-classroom/job-1'),
      {
        params: Promise.resolve({ jobId: 'job-1' }),
      },
    );

    expect(response.status).toBe(401);
  });

  it('returns 404 when the job is missing', async () => {
    readClassroomGenerationJobMock.mockResolvedValue(null);

    const { GET } = await import('@/app/api/generate-classroom/[jobId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/generate-classroom/job-1'),
      {
        params: Promise.resolve({ jobId: 'job-1' }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body.errorCode).toBe('INVALID_REQUEST');
  });

  it('returns 403 when the caller cannot access the job', async () => {
    readClassroomGenerationJobMock.mockResolvedValue({
      id: 'job-1',
      status: 'running',
      step: 'generating_scenes',
      progress: 50,
      message: 'Working',
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      owner: {
        organizationId: 'org-1',
        userId: 'teacher-2',
        actorRole: 'teacher',
      },
      inputSummary: {
        requirementPreview: 'Teach gravity',
        language: 'en-US',
        hasPdf: false,
        pdfTextLength: 0,
        pdfImageCount: 0,
      },
      scenesGenerated: 1,
    });
    canAccessClassroomGenerationJobMock.mockReturnValue(false);

    const { GET } = await import('@/app/api/generate-classroom/[jobId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/generate-classroom/job-1'),
      {
        params: Promise.resolve({ jobId: 'job-1' }),
      },
    );

    expect(response.status).toBe(403);
  });

  it('returns additive partial-generation metadata for succeeded jobs', async () => {
    readClassroomGenerationJobMock.mockResolvedValue({
      id: 'job-1',
      status: 'succeeded',
      step: 'completed',
      progress: 100,
      message: 'Completed with warnings',
      createdAt: '2026-04-19T00:00:00.000Z',
      updatedAt: '2026-04-19T00:00:00.000Z',
      owner: {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher',
      },
      attempt: 1,
      maxAttempts: 1,
      canRetry: false,
      inputSummary: {
        requirementPreview: 'Teach gravity',
        language: 'en-US',
        hasPdf: false,
        pdfTextLength: 0,
        pdfImageCount: 0,
      },
      scenesGenerated: 1,
      scenesFailed: 1,
      totalScenes: 2,
      completionStatus: 'partial',
      warnings: [
        {
          stage: 'scene',
          code: 'content_empty',
          message: 'Scene content generation returned no content',
          sceneIndex: 1,
          sceneTitle: 'Scene 2',
          retryable: false,
          attempts: 1,
        },
      ],
      sceneOutcomes: [
        {
          index: 0,
          title: 'Scene 1',
          status: 'generated',
          stage: 'create',
          sceneId: 'scene-1',
          attempts: 1,
          retryable: false,
          code: 'scene_generated',
          message: 'ok',
        },
        {
          index: 1,
          title: 'Scene 2',
          status: 'failed',
          stage: 'content',
          attempts: 1,
          retryable: false,
          code: 'content_empty',
          message: 'Scene content generation returned no content',
        },
      ],
      scheduledClassEvent: {
        id: 'event-1',
        title: 'Teach gravity',
        startsAt: '2099-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: 'classroom-1',
        createdAt: '2026-04-19T00:00:00.000Z',
        updatedAt: '2026-04-19T00:00:00.000Z',
      },
      scheduledClassError: 'schedule warning',
      result: {
        classroomId: 'classroom-1',
        url: 'http://localhost:3000/classroom/classroom-1',
        scenesCount: 1,
        totalScenes: 2,
        completionStatus: 'partial',
        warnings: [
          {
            stage: 'scene',
            code: 'content_empty',
            message: 'Scene content generation returned no content',
            sceneIndex: 1,
            sceneTitle: 'Scene 2',
            retryable: false,
            attempts: 1,
          },
        ],
        sceneOutcomes: [
          {
            index: 0,
            title: 'Scene 1',
            status: 'generated',
            stage: 'create',
            sceneId: 'scene-1',
            attempts: 1,
            retryable: false,
            code: 'scene_generated',
            message: 'ok',
          },
        ],
      },
    });

    const { GET } = await import('@/app/api/generate-classroom/[jobId]/route');
    const response = await GET(
      new NextRequest('http://localhost:3000/api/generate-classroom/job-1'),
      {
        params: Promise.resolve({ jobId: 'job-1' }),
      },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      jobId: 'job-1',
      status: 'succeeded',
      scenesGenerated: 1,
      scenesFailed: 1,
      totalScenes: 2,
      attempt: 1,
      maxAttempts: 1,
      canRetry: false,
      completionStatus: 'partial',
      warnings: [
        expect.objectContaining({
          code: 'content_empty',
        }),
      ],
      scheduledClassEvent: expect.objectContaining({
        id: 'event-1',
        classroomId: 'classroom-1',
      }),
      scheduledClassError: 'schedule warning',
      result: {
        id: 'classroom-1',
        url: 'http://localhost:3000/classroom/classroom-1',
        scenesCount: 1,
        totalScenes: 2,
        completionStatus: 'partial',
      },
      done: true,
    });
  });
});
