import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

async function importJobStore(tempDir: string, options?: { writeDelayMs?: number }) {
  vi.doMock('@/lib/server/classroom-storage', () => ({
    CLASSROOM_JOBS_DIR: tempDir,
    ensureClassroomJobsDir: async () => {
      await mkdir(tempDir, { recursive: true });
    },
    writeJsonFileAtomic: async (filePath: string, data: unknown) => {
      if (options?.writeDelayMs) {
        await new Promise((resolve) => setTimeout(resolve, options.writeDelayMs));
      }
      await mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
    },
  }));

  vi.doMock('@/lib/logger', () => ({
    createLogger: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  }));

  return import('@/lib/server/classroom-job-store');
}

describe('classroom generation job store', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('returns the most recent non-failed job for a request key', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      await store.createClassroomGenerationJob(
        'job-1',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      await store.createClassroomGenerationJob(
        'job-2',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      let job = await store.findClassroomGenerationJobByRequestKey('request-1', owner);
      expect(job?.id).toBe('job-2');

      await store.markClassroomGenerationJobFailed('job-2', 'boom');
      job = await store.findClassroomGenerationJobByRequestKey('request-1', owner);
      expect(job?.id).toBe('job-1');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('serializes request-key create-or-reuse so concurrent calls return one job', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir, { writeDelayMs: 20 });
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      const [left, right] = await Promise.all([
        store.createOrReuseClassroomGenerationJob(
          'job-1',
          { requirement: 'Teach gravity' },
          owner,
          'request-1',
        ),
        store.createOrReuseClassroomGenerationJob(
          'job-2',
          { requirement: 'Teach gravity' },
          owner,
          'request-1',
        ),
      ]);

      const winning = left.existing ? right.job.id : left.job.id;
      expect(right.job.id).toBe(winning);
      expect(left.job.id).toBe(winning);
      expect([left.existing, right.existing].sort()).toEqual([false, true]);

      const files = await readdir(tempDir);
      expect(
        files.filter((file) => file.endsWith('.json') && !file.startsWith('.request-key-')),
      ).toHaveLength(1);
      expect(files.some((file) => file.startsWith('.request-key-'))).toBe(true);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('reuses a claimed non-failed job and retries when the claim points to a failed job', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir, { writeDelayMs: 20 });
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      const first = await store.createOrReuseClassroomGenerationJob(
        'job-1',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );
      expect(first.existing).toBe(false);
      expect(first.job.id).toBe('job-1');

      await store.markClassroomGenerationJobFailed('job-1', 'boom');

      const second = await store.createOrReuseClassroomGenerationJob(
        'job-2',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );
      expect(second.existing).toBe(false);
      expect(second.job.id).toBe('job-2');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('recovers from stale missing request-key claim entries', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      await store.createOrReuseClassroomGenerationJob(
        'job-1',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      const files = await readdir(tempDir);
      const claimFile = files.find((entry) => entry.startsWith('.request-key-'));
      expect(claimFile).toBeDefined();

      await rm(path.join(tempDir, 'job-1.json'), { force: true });

      const claimPath = path.join(tempDir, claimFile!);
      const claimRaw = JSON.parse(await readFile(claimPath, 'utf-8'));
      claimRaw.createdAt = new Date(Date.now() - 120_000).toISOString();
      await writeFile(claimPath, JSON.stringify(claimRaw, null, 2), 'utf-8');

      const recovered = await store.createOrReuseClassroomGenerationJob(
        'job-2',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      expect(recovered.existing).toBe(false);
      expect(recovered.job.id).toBe('job-2');
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('keeps request-key claims attached to long-running jobs during reuse checks', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      await store.createOrReuseClassroomGenerationJob(
        'job-1',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      await writeFile(
        path.join(tempDir, 'job-1.json'),
        JSON.stringify(
          {
            id: 'job-1',
            requestKey: 'request-1',
            status: 'running',
            step: 'generating_media',
            progress: 80,
            message: 'Working',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-18T00:00:00.000Z',
            owner,
            inputSummary: {
              requirementPreview: 'Teach gravity',
              language: 'en-US',
              hasPdf: false,
              pdfTextLength: 0,
              pdfImageCount: 0,
            },
            scenesGenerated: 1,
          },
          null,
          2,
        ),
        'utf-8',
      );

      const reused = await store.createOrReuseClassroomGenerationJob(
        'job-2',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      expect(reused.existing).toBe(true);
      expect(reused.job.id).toBe('job-1');

      const files = await readdir(tempDir);
      expect(
        files.filter((file) => file.endsWith('.json') && !file.startsWith('.request-key-')),
      ).toHaveLength(1);
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('ignores unrelated corrupt job files during request-key scans', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      await store.createClassroomGenerationJob(
        'job-1',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );
      await writeFile(path.join(tempDir, 'broken.json'), '{not valid json', 'utf-8');

      await expect(
        store.findClassroomGenerationJobByRequestKey('request-1', owner),
      ).resolves.toMatchObject({
        id: 'job-1',
        requestKey: 'request-1',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('marks stale running jobs as failed on read', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const filePath = path.join(tempDir, 'job-stale.json');
      await mkdir(tempDir, { recursive: true });
      await writeFile(
        filePath,
        JSON.stringify(
          {
            id: 'job-stale',
            status: 'running',
            step: 'generating_scenes',
            progress: 50,
            message: 'Working',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-18T00:00:00.000Z',
            owner: {
              organizationId: 'org-1',
              userId: 'teacher-1',
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
          },
          null,
          2,
        ),
        'utf-8',
      );

      const job = await store.readClassroomGenerationJob('job-stale');

      expect(job).toMatchObject({
        status: 'failed',
        canRetry: true,
        completionStatus: 'failed',
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('persists partial-success metadata on succeeded jobs', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };

      await store.createClassroomGenerationJob(
        'job-1',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      await store.markClassroomGenerationJobSucceeded(
        'job-1',
        {
          id: 'classroom-1',
          url: 'http://localhost:3000/classroom/classroom-1',
          stage: {} as never,
          scenes: [],
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
          createdAt: '2026-04-19T00:00:00.000Z',
        },
        {
          scheduledClassEvent: {
            id: 'event-1',
            title: 'Teach gravity',
            startsAt: '2099-05-12T17:00:00.000Z',
            classroomId: 'classroom-1',
            createdAt: '2026-04-19T00:00:00.000Z',
            updatedAt: '2026-04-19T00:00:00.000Z',
          },
        },
      );

      const raw = JSON.parse(await readFile(path.join(tempDir, 'job-1.json'), 'utf-8'));
      expect(raw).toMatchObject({
        status: 'succeeded',
        completionStatus: 'partial',
        scenesGenerated: 1,
        scenesFailed: 1,
        result: {
          totalScenes: 2,
          completionStatus: 'partial',
        },
        scheduledClassEvent: {
          id: 'event-1',
          classroomId: 'classroom-1',
        },
        warnings: [
          expect.objectContaining({
            code: 'content_empty',
          }),
        ],
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});
