import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { afterMock } = vi.hoisted(() => ({
  afterMock: vi.fn(),
}));

const buildRequestOriginMock = vi.fn();
const createClassroomGenerationJobMock = vi.fn();
const createOrReuseClassroomGenerationJobMock = vi.fn();
const nanoidMock = vi.fn();
const requireRequestRoleMock = vi.fn();
const runClassroomGenerationJobMock = vi.fn();

vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: afterMock,
  };
});

vi.mock('nanoid', () => ({
  nanoid: nanoidMock,
}));

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/classroom-job-runner', () => ({
  runClassroomGenerationJob: runClassroomGenerationJobMock,
}));

vi.mock('@/lib/server/classroom-job-store', () => ({
  createOrReuseClassroomGenerationJob: createOrReuseClassroomGenerationJobMock,
  createClassroomGenerationJob: createClassroomGenerationJobMock,
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

describe('POST /api/generate-classroom', () => {
  beforeEach(() => {
    vi.resetModules();
    afterMock.mockReset();
    buildRequestOriginMock.mockReset();
    createOrReuseClassroomGenerationJobMock.mockReset();
    createClassroomGenerationJobMock.mockReset();
    nanoidMock.mockReset();
    requireRequestRoleMock.mockReset();
    runClassroomGenerationJobMock.mockReset();

    afterMock.mockImplementation((callback: () => unknown) => {
      void callback();
    });
    buildRequestOriginMock.mockReturnValue('http://localhost:3000');
    createOrReuseClassroomGenerationJobMock.mockImplementation(async (jobId: string) => ({
      existing: false,
      job: {
        id: jobId,
        status: 'pending',
        step: 'initializing',
        message: 'Queued',
      },
    }));
    createClassroomGenerationJobMock.mockResolvedValue({
      id: 'job-123456',
      status: 'pending',
      step: 'initializing',
      message: 'Queued',
    });
    nanoidMock.mockReturnValue('job-123456');
    requireRequestRoleMock.mockResolvedValue(authContext);
    runClassroomGenerationJobMock.mockResolvedValue(undefined);
  });

  it('rejects classroom-generation requests without a requirement', async () => {
    const { POST } = await import('@/app/api/generate-classroom/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate-classroom', {
        method: 'POST',
        body: JSON.stringify({}),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('MISSING_REQUIRED_FIELD');
    expect(createClassroomGenerationJobMock).not.toHaveBeenCalled();
  });

  it('creates a classroom-generation job and schedules the async runner', async () => {
    const { POST } = await import('@/app/api/generate-classroom/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate-classroom', {
        method: 'POST',
        body: JSON.stringify({
          requirement: 'Create a renewable energy classroom',
          enableImageGeneration: true,
          imageProviderOverride: {
            providerId: 'seedream',
            modelId: 'seedream-model',
          },
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      jobId: 'job-123456',
      status: 'pending',
      step: 'initializing',
      message: 'Queued',
      pollUrl: 'http://localhost:3000/api/generate-classroom/job-123456',
      pollIntervalMs: 5000,
    });
    expect(createClassroomGenerationJobMock).toHaveBeenCalledWith(
      'job-123456',
      expect.objectContaining({
        requirement: 'Create a renewable energy classroom',
        enableImageGeneration: true,
        imageProviderOverride: {
          providerId: 'seedream',
          modelId: 'seedream-model',
        },
      }),
      {
        actorRole: 'teacher',
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );
    expect(runClassroomGenerationJobMock).toHaveBeenCalledWith(
      'job-123456',
      expect.objectContaining({
        requirement: 'Create a renewable energy classroom',
      }),
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );
  });

  it('reuses an existing job for the same request key', async () => {
    createOrReuseClassroomGenerationJobMock.mockResolvedValue({
      existing: true,
      job: {
        id: 'job-existing',
        status: 'running',
        step: 'generating_outlines',
        message: 'Still working',
      },
    });

    const { POST } = await import('@/app/api/generate-classroom/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate-classroom', {
        method: 'POST',
        body: JSON.stringify({
          requirement: 'Create a renewable energy classroom',
          requestKey: 'session-123',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      jobId: 'job-existing',
      status: 'running',
      step: 'generating_outlines',
      message: 'Still working',
      pollUrl: 'http://localhost:3000/api/generate-classroom/job-existing',
      pollIntervalMs: 5000,
    });
    expect(createOrReuseClassroomGenerationJobMock).toHaveBeenCalledWith(
      'job-123456',
      expect.objectContaining({
        requirement: 'Create a renewable energy classroom',
        requestKey: 'session-123',
      }),
      {
        actorRole: 'teacher',
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
      'session-123',
    );
    expect(createClassroomGenerationJobMock).not.toHaveBeenCalled();
    expect(runClassroomGenerationJobMock).toHaveBeenCalledWith(
      'job-existing',
      expect.objectContaining({
        requirement: 'Create a renewable energy classroom',
        requestKey: 'session-123',
      }),
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );
  });

  it('returns a completed job without scheduling a rerun', async () => {
    createOrReuseClassroomGenerationJobMock.mockResolvedValue({
      existing: true,
      job: {
        id: 'job-complete',
        status: 'succeeded',
        step: 'completed',
        message: 'Done',
      },
    });

    const { POST } = await import('@/app/api/generate-classroom/route');
    const response = await POST(
      new NextRequest('http://localhost/api/generate-classroom', {
        method: 'POST',
        body: JSON.stringify({
          requirement: 'Create a renewable energy classroom',
          requestKey: 'session-456',
        }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toEqual({
      success: true,
      jobId: 'job-complete',
      status: 'succeeded',
      step: 'completed',
      message: 'Done',
      pollUrl: 'http://localhost:3000/api/generate-classroom/job-complete',
      pollIntervalMs: 5000,
    });
    expect(runClassroomGenerationJobMock).not.toHaveBeenCalled();
  });
});
