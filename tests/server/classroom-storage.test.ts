import { promises as fs } from 'fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

function createMockRequest(origin: string, headers?: Record<string, string>) {
  return {
    headers: {
      get(name: string) {
        const normalizedName = name.toLowerCase();
        return (
          Object.entries(headers ?? {}).find(
            ([key]) => key.toLowerCase() === normalizedName,
          )?.[1] ?? null
        );
      },
    },
    nextUrl: new URL(origin),
  } as never;
}

describe('classroom-storage helpers', () => {
  const originalCwd = process.cwd();
  let testRoot = '';

  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    testRoot = path.join(
      originalCwd,
      '.vitest-tmp',
      `classroom-storage-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
  });

  afterEach(async () => {
    vi.doUnmock('@/lib/db/client');
    vi.doUnmock('@/lib/db/repositories/classrooms');
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(testRoot, {
      recursive: true,
      force: true,
    });
  });

  it('resolves classroom JSON paths inside the classroom data directory', async () => {
    const { CLASSROOMS_DIR, resolveClassroomJsonPath } =
      await import('@/lib/server/classroom-storage');

    expect(resolveClassroomJsonPath('safe-id')).toBe(path.resolve(CLASSROOMS_DIR, 'safe-id.json'));
  });

  it('rejects classroom IDs whose resolved path escapes the classroom data directory', async () => {
    const { resolveClassroomJsonPath } = await import('@/lib/server/classroom-storage');

    expect(() => resolveClassroomJsonPath('../escape')).toThrow('Invalid classroom id');
  });

  it('prefers APP_BASE_URL when building absolute classroom URLs', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://app.example.com/classrooms/root?foo=bar');

    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(createMockRequest('http://localhost:3000/api/classroom'));

    expect(origin).toBe('https://app.example.com');
  });

  it('falls back to the request origin when APP_BASE_URL is unset', async () => {
    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(createMockRequest('http://localhost:3000/api/classroom'));

    expect(origin).toBe('http://localhost:3000');
  });

  it('ignores forwarded headers when APP_BASE_URL is set', async () => {
    vi.stubEnv('APP_BASE_URL', 'https://app.example.com/root');

    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(
      createMockRequest('http://localhost:3000/api/classroom', {
        'x-forwarded-host': 'evil.example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(origin).toBe('https://app.example.com');
  });

  it('ignores forwarded headers when falling back to req.nextUrl.origin', async () => {
    const { buildRequestOrigin } = await import('@/lib/server/classroom-storage');

    const origin = buildRequestOrigin(
      createMockRequest('http://localhost:3000/api/classroom', {
        'x-forwarded-host': 'evil.example.com',
        'x-forwarded-proto': 'https',
      }),
    );

    expect(origin).toBe('http://localhost:3000');
  });

  it('retries atomic writes after a transient Windows rename lock', async () => {
    const realRename = fs.rename;
    const rename = vi.spyOn(fs, 'rename');
    let attempts = 0;

    rename.mockImplementation(async (from, to) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('locked') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }
      return realRename(from, to);
    });

    const filePath = path.join(process.cwd(), 'data', 'classrooms', 'atomic-write.json');
    const { writeJsonFileAtomic } = await import('@/lib/server/classroom-storage');

    await writeJsonFileAtomic(filePath, { ok: true });

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toContain('"ok": true');
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it('retries atomic writes after a transient temp-file rename ENOENT', async () => {
    const realRename = fs.rename;
    const rename = vi.spyOn(fs, 'rename');
    let attempts = 0;

    rename.mockImplementation(async (from, to) => {
      attempts += 1;
      if (attempts === 1) {
        await fs.rm(from, { force: true }).catch(() => undefined);
        const error = new Error('missing temp file') as NodeJS.ErrnoException;
        error.code = 'ENOENT';
        throw error;
      }
      return realRename(from, to);
    });

    const filePath = path.join(process.cwd(), 'data', 'classrooms', 'atomic-write-enoent.json');
    const { writeJsonFileAtomic } = await import('@/lib/server/classroom-storage');

    await writeJsonFileAtomic(filePath, { ok: true });

    await expect(fs.readFile(filePath, 'utf-8')).resolves.toContain('"ok": true');
    expect(rename).toHaveBeenCalledTimes(2);
  });

  it('serializes concurrent classroom updates against the latest persisted state', async () => {
    const { persistClassroom, readClassroom, updateClassroom } =
      await import('@/lib/server/classroom-storage');

    await persistClassroom(
      {
        id: 'room-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: {
          id: 'room-1',
          name: 'Base',
          createdAt: 1,
          updatedAt: 1,
        },
        scenes: [],
      },
      'http://localhost:3000',
    );

    await Promise.all([
      updateClassroom('room-1', (current) => ({
        ...current,
        stage: {
          ...current.stage,
          name: `${current.stage.name}-A`,
        },
      })),
      updateClassroom('room-1', (current) => ({
        ...current,
        stage: {
          ...current.stage,
          name: `${current.stage.name}-B`,
        },
      })),
    ]);

    const stored = await readClassroom('room-1');
    expect(stored?.stage.name).toMatch(/^Base-(A-B|B-A)$/);
  });

  it('initializes roomVersion and increments it only when classroom content changes', async () => {
    const { persistClassroom, readClassroom, updateClassroom } =
      await import('@/lib/server/classroom-storage');

    await persistClassroom(
      {
        id: 'room-room-version',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: {
          id: 'room-room-version',
          name: 'Base',
          createdAt: 1,
          updatedAt: 1,
        },
        scenes: [],
      },
      'http://localhost:3000',
    );

    expect((await readClassroom('room-room-version'))?.roomVersion).toBe(0);

    await updateClassroom('room-room-version', (current) => ({
      ...current,
    }));
    expect((await readClassroom('room-room-version'))?.roomVersion).toBe(0);

    await updateClassroom('room-room-version', (current) => ({
      ...current,
      stage: {
        ...current.stage,
        name: 'Updated',
      },
    }));
    expect((await readClassroom('room-room-version'))?.roomVersion).toBe(1);
  });

  it('lists only classrooms accessible to the current teacher in JSON storage', async () => {
    const { listAccessibleClassroomSummaries, persistClassroom } =
      await import('@/lib/server/classroom-storage');

    await persistClassroom(
      {
        id: 'teacher-room',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        stage: {
          id: 'teacher-room',
          name: 'Teacher room',
          description: 'Visible',
          createdAt: 1,
          updatedAt: 1,
        },
        scenes: [
          {
            id: 'scene-1',
            stageId: 'teacher-room',
            type: 'slide',
            title: 'Intro',
            order: 0,
            content: {
              type: 'slide',
              canvas: { id: 'slide-1', elements: [] },
            } as never,
            createdAt: 1,
            updatedAt: 1,
          },
        ],
      },
      'http://localhost:3000',
    );
    await persistClassroom(
      {
        id: 'other-room',
        ownerUserId: 'teacher-2',
        organizationId: 'org-1',
        stage: {
          id: 'other-room',
          name: 'Other room',
          createdAt: 1,
          updatedAt: 1,
        },
        scenes: [],
      },
      'http://localhost:3000',
    );

    const summaries = await listAccessibleClassroomSummaries({
      role: 'teacher',
      userId: 'teacher-1',
      organizationId: 'org-1',
    });

    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: 'teacher-room',
      name: 'Teacher room',
      description: 'Visible',
      sceneCount: 1,
    });
  });

  it('lists organization and system admin classroom summaries in JSON storage', async () => {
    const { listAccessibleClassroomSummaries, persistClassroom } =
      await import('@/lib/server/classroom-storage');

    await Promise.all([
      persistClassroom(
        {
          id: 'org-room',
          ownerUserId: 'teacher-1',
          organizationId: 'org-1',
          stage: {
            id: 'org-room',
            name: 'Org room',
            createdAt: 1,
            updatedAt: 1,
          },
          scenes: [],
        },
        'http://localhost:3000',
      ),
      persistClassroom(
        {
          id: 'other-org-room',
          ownerUserId: 'teacher-2',
          organizationId: 'org-2',
          stage: {
            id: 'other-org-room',
            name: 'Other org room',
            createdAt: 1,
            updatedAt: 1,
          },
          scenes: [],
        },
        'http://localhost:3000',
      ),
    ]);

    const orgAdminSummaries = await listAccessibleClassroomSummaries({
      role: 'org_admin',
      userId: 'admin-1',
      organizationId: 'org-1',
    });
    const systemAdminSummaries = await listAccessibleClassroomSummaries({
      role: 'system_admin',
      userId: 'system-admin-1',
      organizationId: null,
    });

    expect(orgAdminSummaries.map((summary) => summary.id)).toEqual(['org-room']);
    expect(systemAdminSummaries.map((summary) => summary.id).sort()).toEqual([
      'org-room',
      'other-org-room',
    ]);
  });

  it('summarizes classroom records from Postgres storage when configured', async () => {
    const runPostgresQuery = vi.fn().mockResolvedValue([
      {
        id: 'postgres-room',
        owner_user_id: 'teacher-1',
        organization_id: 'org-1',
        room_version: 0,
        stage: {
          id: 'postgres-room',
          name: 'Postgres room',
          description: 'Durable',
          createdAt: 1,
          updatedAt: 2,
        },
        scenes: [
          {
            id: 'scene-1',
            stageId: 'postgres-room',
            type: 'slide',
            title: 'Intro',
            order: 0,
            content: {
              type: 'slide',
              canvas: { id: 'slide-1', elements: [] },
            },
            createdAt: 1,
            updatedAt: 2,
          },
        ],
        created_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T01:00:00.000Z',
      },
    ]);

    vi.doMock('@/lib/db/client', () => ({
      isPostgresConfigured: () => true,
      runPostgresQuery,
      runPostgresTransaction: vi.fn(),
    }));

    const { listAccessibleClassroomSummaries } = await import('@/lib/server/classroom-storage');
    const summaries = await listAccessibleClassroomSummaries({
      role: 'teacher',
      userId: 'teacher-1',
      organizationId: 'org-1',
    });

    expect(runPostgresQuery.mock.calls[0]?.[1]).toEqual(['teacher-1']);
    expect(summaries).toEqual([
      {
        id: 'postgres-room',
        name: 'Postgres room',
        description: 'Durable',
        sceneCount: 1,
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T01:00:00.000Z',
      },
    ]);
  });
});
