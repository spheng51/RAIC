import path from 'node:path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_PLATFORM_STORE, type PlatformStore } from '@/lib/db/schema';

type DbGlobals = typeof globalThis & {
  __raicPlatformJsonLock?: Promise<void>;
  __raicPlatformSchemaPromise?: Promise<void>;
  __raicPlatformSqlClient?: unknown;
};

function resetDbGlobals() {
  const globals = globalThis as DbGlobals;
  delete globals.__raicPlatformJsonLock;
  delete globals.__raicPlatformSchemaPromise;
  delete globals.__raicPlatformSqlClient;
}

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
  };
}

describe('platform retention cleanup', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resetDbGlobals();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetDbGlobals();
    await fs.rm(path.join(process.cwd(), 'data', 'platform'), {
      recursive: true,
      force: true,
    });
  });

  it('summarizes stale JSON fallback candidates in dry-run mode', async () => {
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
    });
    expect(result.candidates).toEqual({
      sessions: 1,
      joinTokens: 1,
      guestUsers: 1,
      auditLogs: 1,
    });
  });

  it('removes stale sessions, expired join tokens, old audit logs, and orphaned guest users', async () => {
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
    });

    const store = await readPlatformStore();
    expect(store.sessions.map((session) => session.id)).toEqual(['session-active']);
    expect(store.joinTokens.map((joinToken) => joinToken.id)).toEqual(['join-active']);
    expect(store.auditLogs.map((auditLog) => auditLog.id)).toEqual(['audit-active']);
    expect(store.users.map((user) => user.id).sort()).toEqual(['guest-active', 'teacher-1']);
    expect(store.memberships).toHaveLength(0);
  });

  it('rejects invalid retention policy values', async () => {
    const { resolvePlatformRetentionPolicy } = await import('@/lib/server/platform-retention');

    expect(() =>
      resolvePlatformRetentionPolicy({ staleSessionRetentionDays: 0 }),
    ).toThrow('staleSessionRetentionDays must be a positive integer');
  });
});
