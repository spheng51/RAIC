import { beforeEach, describe, expect, it, vi } from 'vitest';

const generateClassroomMock = vi.fn();
const markClassroomGenerationJobRunningMock = vi.fn();
const markClassroomGenerationJobSucceededMock = vi.fn();
const markClassroomGenerationJobFailedMock = vi.fn();
const updateClassroomGenerationJobProgressMock = vi.fn();

vi.mock('@/lib/server/classroom-generation', () => ({
  generateClassroom: generateClassroomMock,
}));

vi.mock('@/lib/server/classroom-job-store', () => ({
  markClassroomGenerationJobRunning: markClassroomGenerationJobRunningMock,
  markClassroomGenerationJobSucceeded: markClassroomGenerationJobSucceededMock,
  markClassroomGenerationJobFailed: markClassroomGenerationJobFailedMock,
  updateClassroomGenerationJobProgress: updateClassroomGenerationJobProgressMock,
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

    generateClassroomMock.mockResolvedValue({
      id: 'classroom-1',
      url: 'http://localhost:3000/classroom/classroom-1',
      stage: {} as never,
      scenes: [],
      scenesCount: 0,
      createdAt: '2026-04-12T00:00:00.000Z',
    });
    markClassroomGenerationJobRunningMock.mockResolvedValue(undefined);
    markClassroomGenerationJobSucceededMock.mockResolvedValue(undefined);
    markClassroomGenerationJobFailedMock.mockResolvedValue(undefined);
    updateClassroomGenerationJobProgressMock.mockResolvedValue(undefined);
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
    );
  });
});
