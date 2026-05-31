import os from 'node:os';
import path from 'node:path';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type MockPostgresJobRow = {
  id: string;
  request_key: string | null;
  status: string;
  step: string;
  progress: number;
  message: string;
  owner_organization_id: string | null;
  owner_user_id: string | null;
  owner_actor_role: string | null;
  input_summary: unknown;
  scenes_generated: number;
  scenes_failed: number | null;
  total_scenes: number | null;
  completion_status: string | null;
  warnings: unknown;
  scene_outcomes: unknown;
  scheduled_class_event: unknown;
  scheduled_class_error: string | null;
  result: unknown;
  error: string | null;
  attempt: number | null;
  max_attempts: number | null;
  can_retry: boolean | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

async function importJobStore(tempDir: string, options?: { writeDelayMs?: number }) {
  vi.doMock('@/lib/db/client', () => ({
    isPostgresConfigured: () => false,
    runPostgresQuery: vi.fn(async () => null),
  }));

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

function parseJsonParam(value: unknown): unknown {
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function rowFromJobParams(params: unknown[]): MockPostgresJobRow {
  return {
    id: params[0] as string,
    request_key: (params[1] as string | null) ?? null,
    status: params[2] as string,
    step: params[3] as string,
    progress: Number(params[4]),
    message: params[5] as string,
    owner_organization_id: (params[6] as string | null) ?? null,
    owner_user_id: (params[7] as string | null) ?? null,
    owner_actor_role: (params[8] as string | null) ?? null,
    input_summary: parseJsonParam(params[9]),
    scenes_generated: Number(params[10]),
    scenes_failed: params[11] === null ? null : Number(params[11]),
    total_scenes: params[12] === null ? null : Number(params[12]),
    completion_status: (params[13] as string | null) ?? null,
    warnings: parseJsonParam(params[14]),
    scene_outcomes: parseJsonParam(params[15]),
    scheduled_class_event: params[16] === null ? null : parseJsonParam(params[16]),
    scheduled_class_error: (params[17] as string | null) ?? null,
    result: params[18] === null ? null : parseJsonParam(params[18]),
    error: (params[19] as string | null) ?? null,
    attempt: params[20] === null ? null : Number(params[20]),
    max_attempts: params[21] === null ? null : Number(params[21]),
    can_retry: (params[22] as boolean | null) ?? null,
    started_at: (params[23] as string | null) ?? null,
    completed_at: (params[24] as string | null) ?? null,
    created_at: params[25] as string,
    updated_at: params[26] as string,
  };
}

function sameOwner(
  row: MockPostgresJobRow,
  organizationId: unknown,
  userId: unknown,
  actorRole: unknown,
) {
  return (
    row.owner_organization_id === organizationId &&
    row.owner_user_id === userId &&
    row.owner_actor_role === actorRole
  );
}

function createMockPostgresJobDb() {
  const rows: MockPostgresJobRow[] = [];
  const runPostgresQuery = vi.fn(async (query: string, params: unknown[] = []) => {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();

    if (normalizedQuery.startsWith('INSERT INTO classroom_generation_jobs')) {
      const next = rowFromJobParams(params);
      const hasConflict = rows.some(
        (row) =>
          row.id === next.id ||
          (next.request_key &&
            row.request_key === next.request_key &&
            row.status !== 'failed' &&
            next.status !== 'failed' &&
            sameOwner(row, next.owner_organization_id, next.owner_user_id, next.owner_actor_role)),
      );
      if (hasConflict) return [];
      rows.push(next);
      return [next];
    }

    if (normalizedQuery.startsWith('UPDATE classroom_generation_jobs')) {
      const updated = rowFromJobParams(params);
      const index = rows.findIndex((row) => row.id === updated.id);
      if (index === -1) return [];
      rows[index] = updated;
      return [updated];
    }

    if (normalizedQuery.includes('WHERE id = $1')) {
      return rows.filter((row) => row.id === params[0]).slice(0, 1);
    }

    if (normalizedQuery.includes('WHERE request_key = $1')) {
      return rows
        .filter(
          (row) =>
            row.request_key === params[0] &&
            sameOwner(row, params[1], params[2], params[3]) &&
            row.status !== 'failed',
        )
        .sort(
          (left, right) =>
            new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime(),
        )
        .slice(0, 1);
    }

    return [];
  });

  return { rows, runPostgresQuery };
}

async function importPostgresJobStore() {
  const db = createMockPostgresJobDb();
  vi.doMock('@/lib/db/client', () => ({
    isPostgresConfigured: () => true,
    runPostgresQuery: db.runPostgresQuery,
  }));
  vi.doMock('@/lib/logger', () => ({
    createLogger: () => ({
      debug: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    }),
  }));

  const store = await import('@/lib/server/classroom-job-store');
  return { db, store };
}

describe('classroom generation job store', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock('@/lib/db/client');
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
            startedAt: '2026-04-19T00:00:00.000Z',
            updatedAt: new Date().toISOString(),
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

  it('does not reuse stale running request-key jobs during file scans', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };
      const staleUpdatedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

      await store.createClassroomGenerationJob(
        'job-stale',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );
      await writeFile(
        path.join(tempDir, 'job-stale.json'),
        JSON.stringify(
          {
            id: 'job-stale',
            requestKey: 'request-1',
            status: 'running',
            step: 'generating_media',
            progress: 80,
            message: 'Working',
            createdAt: '2026-04-19T00:00:00.000Z',
            startedAt: '2026-04-19T00:00:00.000Z',
            updatedAt: staleUpdatedAt,
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

      await expect(store.findClassroomGenerationJobByRequestKey('request-1', owner)).resolves.toBe(
        null,
      );

      const retry = await store.createOrReuseClassroomGenerationJob(
        'job-retry',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      expect(retry.existing).toBe(false);
      expect(retry.job.id).toBe('job-retry');

      const staleRaw = JSON.parse(await readFile(path.join(tempDir, 'job-stale.json'), 'utf-8'));
      expect(staleRaw).toMatchObject({
        status: 'failed',
        completionStatus: 'failed',
        canRetry: true,
      });
    } finally {
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  it('does not let stale claimed request-key jobs block retries', async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), 'raic-job-store-'));
    try {
      const store = await importJobStore(tempDir);
      const owner = {
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher' as const,
      };
      const staleUpdatedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();

      const first = await store.createOrReuseClassroomGenerationJob(
        'job-stale',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );
      expect(first.existing).toBe(false);

      await writeFile(
        path.join(tempDir, 'job-stale.json'),
        JSON.stringify(
          {
            id: 'job-stale',
            requestKey: 'request-1',
            status: 'running',
            step: 'generating_media',
            progress: 80,
            message: 'Working',
            createdAt: '2026-04-19T00:00:00.000Z',
            startedAt: '2026-04-19T00:00:00.000Z',
            updatedAt: staleUpdatedAt,
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

      const retry = await store.createOrReuseClassroomGenerationJob(
        'job-retry',
        { requirement: 'Teach gravity' },
        owner,
        'request-1',
      );

      expect(retry.existing).toBe(false);
      expect(retry.job.id).toBe('job-retry');

      const files = await readdir(tempDir);
      expect(
        files.filter((file) => file.endsWith('.json') && !file.startsWith('.request-key-')),
      ).toHaveLength(2);

      const staleRaw = JSON.parse(await readFile(path.join(tempDir, 'job-stale.json'), 'utf-8'));
      expect(staleRaw).toMatchObject({
        status: 'failed',
        completionStatus: 'failed',
        canRetry: true,
      });
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

  it('persists classroom generation job lifecycle in Postgres when configured', async () => {
    const { db, store } = await importPostgresJobStore();
    const owner = {
      organizationId: 'org-1',
      userId: 'teacher-1',
      actorRole: 'teacher' as const,
    };

    await store.createClassroomGenerationJob(
      'pg-job-1',
      { requirement: 'Teach gravity' },
      owner,
      'request-1',
    );

    await expect(store.readClassroomGenerationJob('pg-job-1')).resolves.toMatchObject({
      id: 'pg-job-1',
      requestKey: 'request-1',
      status: 'queued',
      owner,
    });

    await store.updateClassroomGenerationJobProgress('pg-job-1', {
      step: 'generating_scenes',
      progress: 55,
      message: 'Generating scenes',
      scenesGenerated: 1,
      scenesFailed: 0,
      totalScenes: 2,
      warnings: [],
    });

    await store.markClassroomGenerationJobSucceeded(
      'pg-job-1',
      {
        id: 'classroom-1',
        url: 'https://open-raic.com/classroom/classroom-1',
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

    await expect(store.readClassroomGenerationJob('pg-job-1')).resolves.toMatchObject({
      status: 'succeeded',
      completionStatus: 'partial',
      scenesGenerated: 1,
      scenesFailed: 1,
      scheduledClassEvent: {
        id: 'event-1',
        classroomId: 'classroom-1',
      },
      result: {
        classroomId: 'classroom-1',
        totalScenes: 2,
        completionStatus: 'partial',
      },
      warnings: [
        expect.objectContaining({
          code: 'content_empty',
        }),
      ],
    });
    expect(db.rows).toHaveLength(1);
  });

  it('reuses active Postgres request-key jobs and allows retry after failure', async () => {
    const { db, store } = await importPostgresJobStore();
    const owner = {
      organizationId: 'org-1',
      userId: 'teacher-1',
      actorRole: 'teacher' as const,
    };

    const first = await store.createOrReuseClassroomGenerationJob(
      'pg-job-1',
      { requirement: 'Teach gravity' },
      owner,
      'request-1',
    );
    const second = await store.createOrReuseClassroomGenerationJob(
      'pg-job-2',
      { requirement: 'Teach gravity' },
      owner,
      'request-1',
    );

    expect(first.existing).toBe(false);
    expect(second.existing).toBe(true);
    expect(second.job.id).toBe('pg-job-1');
    expect(db.rows).toHaveLength(1);

    await store.markClassroomGenerationJobFailed('pg-job-1', 'boom');
    const retry = await store.createOrReuseClassroomGenerationJob(
      'pg-job-3',
      { requirement: 'Teach gravity' },
      owner,
      'request-1',
    );

    expect(retry.existing).toBe(false);
    expect(retry.job.id).toBe('pg-job-3');
    expect(db.rows).toHaveLength(2);
    expect(db.rows.map((row) => row.status)).toEqual(['failed', 'queued']);
  });

  it('marks stale Postgres request-key jobs failed before retrying', async () => {
    const { db, store } = await importPostgresJobStore();
    const owner = {
      organizationId: 'org-1',
      userId: 'teacher-1',
      actorRole: 'teacher' as const,
    };

    await store.createOrReuseClassroomGenerationJob(
      'pg-job-stale',
      { requirement: 'Teach gravity' },
      owner,
      'request-1',
    );
    const staleUpdatedAt = new Date(Date.now() - 31 * 60 * 1000).toISOString();
    db.rows[0] = {
      ...db.rows[0]!,
      status: 'running',
      step: 'generating_media',
      progress: 80,
      message: 'Working',
      started_at: '2026-04-19T00:00:00.000Z',
      updated_at: staleUpdatedAt,
    };

    const retry = await store.createOrReuseClassroomGenerationJob(
      'pg-job-retry',
      { requirement: 'Teach gravity' },
      owner,
      'request-1',
    );

    expect(retry.existing).toBe(false);
    expect(retry.job.id).toBe('pg-job-retry');
    expect(db.rows).toHaveLength(2);
    expect(db.rows[0]).toMatchObject({
      id: 'pg-job-stale',
      status: 'failed',
      completion_status: 'failed',
      can_retry: true,
    });
    expect(db.rows[1]).toMatchObject({
      id: 'pg-job-retry',
      status: 'queued',
    });
  });
});
