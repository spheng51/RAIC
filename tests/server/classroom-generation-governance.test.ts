import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireRequestRoleMock = vi.fn();
const createClassroomGenerationJobMock = vi.fn();
const runClassroomGenerationJobMock = vi.fn();
const buildRequestOriginMock = vi.fn(() => 'http://localhost:3000');
vi.mock('next/server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('next/server')>();
  return {
    ...actual,
    after: (callback: () => void) => callback(),
  };
});

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/classroom-job-store', () => ({
  createClassroomGenerationJob: createClassroomGenerationJobMock,
}));

vi.mock('@/lib/server/classroom-job-runner', () => ({
  runClassroomGenerationJob: runClassroomGenerationJobMock,
}));

vi.mock('@/lib/server/classroom-storage', () => ({
  buildRequestOrigin: buildRequestOriginMock,
}));

vi.mock('nanoid', () => ({
  nanoid: vi.fn(() => 'job-123'),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const authContext = {
  user: { id: 'teacher-1' },
  session: { role: 'teacher' },
  organization: { id: 'org-1' },
} as never;

describe('classroom generation governance wiring', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    createClassroomGenerationJobMock.mockReset();
    runClassroomGenerationJobMock.mockReset();
    buildRequestOriginMock.mockReset();
    buildRequestOriginMock.mockReturnValue('http://localhost:3000');

    requireRequestRoleMock.mockResolvedValue(authContext);
    createClassroomGenerationJobMock.mockResolvedValue({
      id: 'job-123',
      status: 'queued',
      step: 'queued',
      message: 'queued',
    });
  });

  it('binds queued classroom jobs to the caller organization and user', async () => {
    const { POST } = await import('@/app/api/generate-classroom/route');

    const response = await POST(
      new NextRequest('http://localhost:3000/api/generate-classroom', {
        method: 'POST',
        body: JSON.stringify({
          requirement: 'Teach photosynthesis',
          enableWebSearch: true,
        }),
      }),
    );

    expect(response.status).toBe(202);
    expect(createClassroomGenerationJobMock).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        requirement: 'Teach photosynthesis',
        enableWebSearch: true,
      }),
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher',
      },
    );
    expect(runClassroomGenerationJobMock).toHaveBeenCalledWith(
      'job-123',
      expect.objectContaining({
        requirement: 'Teach photosynthesis',
      }),
      'http://localhost:3000',
      {
        organizationId: 'org-1',
        userId: 'teacher-1',
      },
    );
  });
});
