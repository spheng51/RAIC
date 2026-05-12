import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerateClassroomResult } from '@/lib/server/classroom-generation';

const generateClassroomMock = vi.fn();
const markClassroomGenerationJobRunningMock = vi.fn();
const markClassroomGenerationJobSucceededMock = vi.fn();
const markClassroomGenerationJobFailedMock = vi.fn();
const updateClassroomGenerationJobProgressMock = vi.fn();
const createScheduledClassForAccessMock = vi.fn();

function createGenerationResult(id = 'classroom-1'): GenerateClassroomResult {
  return {
    id,
    url: `http://localhost:3000/classroom/${id}`,
    stage: {} as never,
    scenes: [],
    scenesCount: 0,
    totalScenes: 0,
    completionStatus: 'complete',
    warnings: [],
    sceneOutcomes: [],
    createdAt: '2026-04-12T00:00:00.000Z',
  };
}

vi.mock('@/lib/server/classroom-generation', () => ({
  generateClassroom: generateClassroomMock,
}));

vi.mock('@/lib/server/classroom-job-store', () => ({
  markClassroomGenerationJobRunning: markClassroomGenerationJobRunningMock,
  markClassroomGenerationJobSucceeded: markClassroomGenerationJobSucceededMock,
  markClassroomGenerationJobFailed: markClassroomGenerationJobFailedMock,
  updateClassroomGenerationJobProgress: updateClassroomGenerationJobProgressMock,
}));

vi.mock('@/lib/server/scheduled-classes', () => ({
  createScheduledClassForAccess: createScheduledClassForAccessMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('classroom job runner scope forwarding', () => {
  beforeEach(() => {
    vi.resetModules();
    generateClassroomMock.mockReset();
    markClassroomGenerationJobRunningMock.mockReset();
    markClassroomGenerationJobSucceededMock.mockReset();
    markClassroomGenerationJobFailedMock.mockReset();
    updateClassroomGenerationJobProgressMock.mockReset();
    createScheduledClassForAccessMock.mockReset();

    generateClassroomMock.mockResolvedValue(createGenerationResult());
    markClassroomGenerationJobRunningMock.mockResolvedValue(undefined);
    markClassroomGenerationJobSucceededMock.mockResolvedValue(undefined);
    markClassroomGenerationJobFailedMock.mockResolvedValue(undefined);
    updateClassroomGenerationJobProgressMock.mockResolvedValue(undefined);
    createScheduledClassForAccessMock.mockResolvedValue({
      id: 'event-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'classroom-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
  });

  it('passes org-bound background scope into generateClassroom', async () => {
    const { runClassroomGenerationJob } = await import('@/lib/server/classroom-job-runner');

    await runClassroomGenerationJob(
      'job-123',
      {
        requirement: 'Teach gravity',
        enableWebSearch: true,
      },
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(markClassroomGenerationJobRunningMock).toHaveBeenCalledWith('job-123');
    expect(generateClassroomMock).toHaveBeenCalledWith(
      {
        requirement: 'Teach gravity',
        enableWebSearch: true,
      },
      expect.objectContaining({
        baseUrl: 'http://localhost:3000',
        organizationId: 'org-1',
        userId: 'teacher-1',
        onProgress: expect.any(Function),
      }),
    );
    expect(markClassroomGenerationJobSucceededMock).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        id: 'classroom-1',
      }),
      {},
    );
  });

  it('deduplicates concurrent runs for the same job id', async () => {
    let resolveGeneration: ((value: GenerateClassroomResult) => void) | null = null;
    generateClassroomMock.mockImplementation(
      () =>
        new Promise<GenerateClassroomResult>((resolve) => {
          resolveGeneration = resolve;
        }),
    );

    const { runClassroomGenerationJob } = await import('@/lib/server/classroom-job-runner');

    const first = runClassroomGenerationJob(
      'job-123',
      { requirement: 'Teach gravity' },
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );
    const second = runClassroomGenerationJob(
      'job-123',
      { requirement: 'Teach gravity' },
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(first).toBe(second);
    await Promise.resolve();
    expect(generateClassroomMock).toHaveBeenCalledTimes(1);

    expect(resolveGeneration).not.toBeNull();
    resolveGeneration!(createGenerationResult());

    await Promise.all([first, second]);
    expect(markClassroomGenerationJobSucceededMock).toHaveBeenCalledTimes(1);
  });

  it('links generated classrooms to pending scheduled classes', async () => {
    const { runClassroomGenerationJob } = await import('@/lib/server/classroom-job-runner');

    await runClassroomGenerationJob(
      'job-123',
      {
        requirement: 'Physics lab',
        scheduledClass: {
          title: 'Physics lab',
          startsAt: '2099-05-12T17:00:00.000Z',
          durationMinutes: 45,
        },
      },
      'http://localhost:3000',
      {
        actorRole: 'teacher',
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(createScheduledClassForAccessMock).toHaveBeenCalledWith(
      {
        role: 'teacher',
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
      {
        title: 'Physics lab',
        startsAt: '2099-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: 'classroom-1',
      },
      { requireFutureStart: false },
    );
    expect(markClassroomGenerationJobSucceededMock).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ id: 'classroom-1' }),
      {
        scheduledClassEvent: expect.objectContaining({
          id: 'event-1',
          classroomId: 'classroom-1',
        }),
      },
    );
  });

  it('keeps classroom generation successful when schedule linking fails', async () => {
    createScheduledClassForAccessMock.mockRejectedValueOnce(new Error('schedule write failed'));
    const { runClassroomGenerationJob } = await import('@/lib/server/classroom-job-runner');

    await runClassroomGenerationJob(
      'job-123',
      {
        requirement: 'Physics lab',
        scheduledClass: {
          title: 'Physics lab',
          startsAt: '2099-05-12T17:00:00.000Z',
        },
      },
      'http://localhost:3000',
      {
        actorRole: 'teacher',
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(markClassroomGenerationJobFailedMock).not.toHaveBeenCalled();
    expect(markClassroomGenerationJobSucceededMock).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({ id: 'classroom-1' }),
      {
        scheduledClassError: 'schedule write failed',
      },
    );
  });

  it('marks failures and clears in-memory state for a later rerun', async () => {
    generateClassroomMock.mockRejectedValueOnce(new Error('boom'));

    const { runClassroomGenerationJob } = await import('@/lib/server/classroom-job-runner');

    await runClassroomGenerationJob(
      'job-123',
      { requirement: 'Teach gravity' },
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(markClassroomGenerationJobFailedMock).toHaveBeenCalledWith('job-123', 'boom');

    generateClassroomMock.mockResolvedValueOnce(createGenerationResult('classroom-2'));

    await runClassroomGenerationJob(
      'job-123',
      { requirement: 'Teach gravity' },
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );

    expect(generateClassroomMock).toHaveBeenCalledTimes(2);
    expect(markClassroomGenerationJobRunningMock).toHaveBeenCalledTimes(2);
  });
});
