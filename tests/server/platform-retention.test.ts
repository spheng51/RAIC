import path from 'node:path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PLATFORM_STORE, type PlatformStore } from '@/lib/db/schema';

type DbGlobals = typeof globalThis & {
  __raicPlatformJsonLock?: Promise<void>;
  __raicPlatformSchemaPromise?: Promise<void>;
  __raicPlatformSqlClient?: unknown;
};

type MockPostgresExecutor = {
  unsafe: <T>(query: string, params?: unknown[]) => Promise<T[]>;
  begin?: <T>(handler: (executor: MockPostgresExecutor) => Promise<T>) => Promise<T>;
};

function resetDbGlobals() {
  const globals = globalThis as DbGlobals;
  delete globals.__raicPlatformJsonLock;
  delete globals.__raicPlatformSchemaPromise;
  delete globals.__raicPlatformSqlClient;
}

function setMockPostgresState(client: MockPostgresExecutor) {
  const globals = globalThis as DbGlobals;
  globals.__raicPlatformSqlClient = client;
  globals.__raicPlatformSchemaPromise = Promise.resolve();
}

const originalCwd = process.cwd();
let testRoot = '';
function createStoreFixture(): PlatformStore {
  return {
    ...structuredClone(EMPTY_PLATFORM_STORE),
    users: [
      {
        id: 'teacher-1',
        googleSub: 'google-teacher',
        email: 'teacher@example.com',
        displayName: 'Teacher',
        avatarUrl: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
        lastLoginAt: '2026-04-10T00:00:00.000Z',
      },
      {
        id: 'guest-stale',
        googleSub: null,
        email: 'guest-stale@classroom.raic.local',
        displayName: 'Guest Stale',
        avatarUrl: null,
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        lastLoginAt: null,
      },
      {
        id: 'guest-active',
        googleSub: null,
        email: 'guest-active@classroom.raic.local',
        displayName: 'Guest Active',
        avatarUrl: null,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
        lastLoginAt: null,
      },
    ],
    memberships: [
      {
        id: 'membership-guest-stale',
        organizationId: 'org-1',
        userId: 'guest-stale',
        role: 'student',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
      },
    ],
    sessions: [
      {
        id: 'session-stale',
        userId: 'guest-stale',
        organizationId: 'org-1',
        classroomId: 'room-1',
        role: 'student',
        kind: 'classroom',
        tokenHash: 'session-stale-hash',
        userAgent: 'Playwright',
        ipAddress: '127.0.0.1',
        createdAt: '2026-03-01T00:00:00.000Z',
        updatedAt: '2026-03-01T00:00:00.000Z',
        lastSeenAt: '2026-03-01T00:00:00.000Z',
        expiresAt: '2026-03-05T00:00:00.000Z',
        absoluteExpiresAt: '2026-03-05T00:00:00.000Z',
        revokedAt: null,
      },
      {
        id: 'session-active',
        userId: 'guest-active',
        organizationId: 'org-1',
        classroomId: 'room-1',
        role: 'student',
        kind: 'classroom',
        tokenHash: 'session-active-hash',
        userAgent: 'Playwright',
        ipAddress: '127.0.0.1',
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
        lastSeenAt: '2026-04-10T00:00:00.000Z',
        expiresAt: '2026-04-15T00:00:00.000Z',
        absoluteExpiresAt: '2026-04-15T00:00:00.000Z',
        revokedAt: null,
      },
    ],
    joinTokens: [
      {
        id: 'join-stale',
        classroomId: 'room-1',
        createdByUserId: 'teacher-1',
        organizationId: 'org-1',
        displayName: 'Guest Stale',
        tokenHash: 'join-stale-hash',
        createdAt: '2026-03-01T00:00:00.000Z',
        expiresAt: '2026-03-02T00:00:00.000Z',
        consumedAt: null,
      },
      {
        id: 'join-active',
        classroomId: 'room-1',
        createdByUserId: 'teacher-1',
        organizationId: 'org-1',
        displayName: 'Guest Active',
        tokenHash: 'join-active-hash',
        createdAt: '2026-04-10T00:00:00.000Z',
        expiresAt: '2026-04-12T00:00:00.000Z',
        consumedAt: null,
      },
    ],
    auditLogs: [
      {
        id: 'audit-stale',
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher',
        action: 'classroom.created',
        resourceType: 'classroom',
        resourceId: 'room-1',
        metadata: {},
        createdAt: '2025-12-01T00:00:00.000Z',
      },
      {
        id: 'audit-active',
        organizationId: 'org-1',
        userId: 'teacher-1',
        actorRole: 'teacher',
        action: 'classroom.join_token.redeemed',
        resourceType: 'classroom',
        resourceId: 'room-1',
        metadata: {},
        createdAt: '2026-04-10T00:00:00.000Z',
      },
    ],
    classroomSessionContexts: [
      {
        id: 'context-stale',
        classroomId: 'room-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        requirementFingerprint: 'req-stale',
        requirementPreview: 'Old benchmarked requirement',
        language: 'en-US',
        stageName: 'Old Stage',
        lastCompletedSceneId: 'scene-1',
        lastCompletedSceneTitle: 'Intro',
        completedSceneCount: 1,
        totalSceneCount: 3,
        masteryHints: ['fractions'],
        revisitIntent: 'continue',
        pacingPreference: 'adaptive',
        reflectionSummary: 'Old note',
        confidenceScore: 2,
        createdAt: '2025-12-01T00:00:00.000Z',
        updatedAt: '2025-12-01T00:00:00.000Z',
      },
      {
        id: 'context-active',
        classroomId: 'room-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        requirementFingerprint: 'req-active',
        requirementPreview: 'Current requirement',
        language: 'en-US',
        stageName: 'Current Stage',
        lastCompletedSceneId: 'scene-2',
        lastCompletedSceneTitle: 'Practice',
        completedSceneCount: 2,
        totalSceneCount: 4,
        masteryHints: ['word problems'],
        revisitIntent: 'revisit',
        pacingPreference: 'balance',
        reflectionSummary: 'Keep practicing',
        confidenceScore: 3,
        createdAt: '2026-04-10T00:00:00.000Z',
        updatedAt: '2026-04-10T00:00:00.000Z',
      },
    ],
    classroomReflections: [
      {
        id: 'reflection-stale',
        classroomId: 'room-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        summary: 'Old reflection',
        challengingAreas: ['fractions'],
        confidenceScore: 2,
        revisitIntent: 'remediate',
        createdAt: '2025-12-01T00:00:00.000Z',
      },
      {
        id: 'reflection-active',
        classroomId: 'room-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        summary: 'Recent reflection',
        challengingAreas: ['word problems'],
        confidenceScore: 4,
        revisitIntent: 'continue',
        createdAt: '2026-04-10T00:00:00.000Z',
      },
    ],
    benchmarkArtifacts: [
      {
        id: 'artifact-stale',
        scope: 'classroom-generation',
        source: 'vitest',
        classroomId: 'room-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        status: 'pass',
        metrics: {
          classroomStartToFirstSceneMs: { value: 7200, threshold: 8000, status: 'pass' },
        },
        notes: ['stale artifact'],
        metadata: {},
        createdAt: '2025-12-01T00:00:00.000Z',
      },
      {
        id: 'artifact-active',
        scope: 'classroom-generation',
        source: 'vitest',
        classroomId: 'room-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        status: 'pass',
        metrics: {
          classroomStartToFirstSceneMs: { value: 7100, threshold: 8000, status: 'pass' },
        },
        notes: ['active artifact'],
        metadata: {},
        createdAt: '2026-04-10T00:00:00.000Z',
      },
    ],
  };
}

describe('platform retention cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resetDbGlobals();
    testRoot = path.join(
      originalCwd,
      '.vitest-tmp',
      `platform-retention-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetDbGlobals();
    vi.restoreAllMocks();
    await fs.rm(testRoot, {
      recursive: true,
      force: true,
    });
  });

  it('summarizes stale JSON fallback candidates in dry-run mode', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { updatePlatformStore } = await import('@/lib/db/client');
    await updatePlatformStore((store) => Object.assign(store, createStoreFixture()));

    const { runPlatformRetentionCleanup } = await import('@/lib/server/platform-retention');
    const result = await runPlatformRetentionCleanup({
      dryRun: true,
      now: '2026-04-11T00:00:00.000Z',
    });

    expect(result.mode).toBe('json');
    expect(result.deleted).toEqual({
      sessions: 0,
      joinTokens: 0,
      guestUsers: 0,
      auditLogs: 0,
      sessionContexts: 0,
      reflections: 0,
      benchmarkArtifacts: 0,
    });
    expect(result.candidates).toEqual({
      sessions: 1,
      joinTokens: 1,
      guestUsers: 1,
      auditLogs: 1,
      sessionContexts: 1,
      reflections: 1,
      benchmarkArtifacts: 1,
    });
  });

  it('removes stale sessions, expired join tokens, old audit logs, and orphaned guest users', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { updatePlatformStore, readPlatformStore } = await import('@/lib/db/client');
    await updatePlatformStore((store) => Object.assign(store, createStoreFixture()));

    const { runPlatformRetentionCleanup } = await import('@/lib/server/platform-retention');
    const result = await runPlatformRetentionCleanup({
      dryRun: false,
      now: '2026-04-11T00:00:00.000Z',
    });

    expect(result.deleted).toEqual({
      sessions: 1,
      joinTokens: 1,
      guestUsers: 1,
      auditLogs: 1,
      sessionContexts: 1,
      reflections: 1,
      benchmarkArtifacts: 1,
    });

    const store = await readPlatformStore();
    expect(store.sessions.map((session) => session.id)).toEqual(['session-active']);
    expect(store.joinTokens.map((joinToken) => joinToken.id)).toEqual(['join-active']);
    expect(store.auditLogs.map((auditLog) => auditLog.id)).toEqual(['audit-active']);
    expect(store.classroomSessionContexts.map((context) => context.id)).toEqual(['context-active']);
    expect(store.classroomReflections.map((reflection) => reflection.id)).toEqual([
      'reflection-active',
    ]);
    expect(store.benchmarkArtifacts.map((artifact) => artifact.id)).toEqual(['artifact-active']);
    expect(store.users.map((user) => user.id).sort()).toEqual(['guest-active', 'teacher-1']);
    expect(store.memberships).toHaveLength(0);
  });

  it('rejects invalid retention policy values', async () => {
    const { resolvePlatformRetentionPolicy } = await import('@/lib/server/platform-retention');

    expect(() => resolvePlatformRetentionPolicy({ staleSessionRetentionDays: 0 })).toThrow(
      'staleSessionRetentionDays must be a positive integer',
    );
  });

  it('collects and deletes stale Postgres candidates inside a transaction', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/raic');

    const unsafeMock = vi.fn(async (query: string, _params?: unknown[]) => {
      const normalizedQuery = query.replace(/\s+/g, ' ').trim();

      if (normalizedQuery.startsWith('SELECT u.id')) {
        return [{ id: 'guest-stale' }];
      }

      if (normalizedQuery.startsWith('SELECT id FROM sessions')) {
        return [{ id: 'session-stale' }];
      }

      if (normalizedQuery.startsWith('SELECT id FROM join_tokens')) {
        return [{ id: 'join-stale' }];
      }

      if (normalizedQuery.startsWith('SELECT id FROM audit_logs')) {
        return [{ id: 'audit-stale' }];
      }

      if (normalizedQuery.startsWith('SELECT id FROM classroom_session_contexts')) {
        return [{ id: 'context-stale' }];
      }

      if (normalizedQuery.startsWith('SELECT id FROM classroom_reflections')) {
        return [{ id: 'reflection-stale' }];
      }

      if (normalizedQuery.startsWith('SELECT id FROM benchmark_artifacts')) {
        return [{ id: 'artifact-stale' }];
      }

      return [];
    });

    const client: MockPostgresExecutor = {
      unsafe: unsafeMock as MockPostgresExecutor['unsafe'],
      begin: vi.fn(async (handler) => handler(client)),
    };
    setMockPostgresState(client);

    const { runPlatformRetentionCleanup } = await import('@/lib/server/platform-retention');
    const result = await runPlatformRetentionCleanup({
      dryRun: false,
      now: '2026-04-11T00:00:00.000Z',
    });

    expect(result.mode).toBe('postgres');
    expect(result.deleted).toEqual({
      sessions: 1,
      joinTokens: 1,
      guestUsers: 1,
      auditLogs: 1,
      sessionContexts: 1,
      reflections: 1,
      benchmarkArtifacts: 1,
    });
    expect(client.begin).toHaveBeenCalledTimes(1);
    expect(unsafeMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM sessions'), [
      ['session-stale'],
    ]);
    expect(unsafeMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM join_tokens'), [
      ['join-stale'],
    ]);
    expect(unsafeMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM audit_logs'), [
      ['audit-stale'],
    ]);
    expect(unsafeMock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM classroom_session_contexts'),
      [['context-stale']],
    );
    expect(unsafeMock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM classroom_reflections'),
      [['reflection-stale']],
    );
    expect(unsafeMock).toHaveBeenCalledWith(
      expect.stringContaining('DELETE FROM benchmark_artifacts'),
      [['artifact-stale']],
    );
    expect(unsafeMock).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM users'), [
      ['guest-stale'],
    ]);
  });
});
