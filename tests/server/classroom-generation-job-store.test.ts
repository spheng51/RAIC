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

      expect(left.job.id).toBe('job-1');
      expect(right.job.id).toBe('job-1');
      expect([left.existing, right.existing].sort()).toEqual([false, true]);

      const files = await readdir(tempDir);
      expect(files.filter((file) => file.endsWith('.json'))).toHaveLength(1);
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

      await store.markClassroomGenerationJobSucceeded('job-1', {
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
      });

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
