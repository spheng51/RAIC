import path from 'node:path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

describe('db client persistence helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock('module');
    resetDbGlobals();
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    vi.doUnmock('module');
    resetDbGlobals();
    await fs.rm(path.join(process.cwd(), 'data', 'platform'), {
      recursive: true,
      force: true,
    });
  });

  it('uses the JSON fallback when DATABASE_URL is unset', async () => {
    const { getPersistenceMode, updatePlatformStore, readPlatformStore } = await import('@/lib/db/client');

    expect(await getPersistenceMode()).toBe('json');

    await updatePlatformStore((store) => {
      store.users.push({
        id: 'user-1',
        googleSub: null,
        email: 'teacher@example.com',
        displayName: 'Teacher',
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: null,
      });
    });

    const store = await readPlatformStore();
    expect(store.users).toHaveLength(1);
    expect(store.users[0]?.id).toBe('user-1');
  });

  it('throws when DATABASE_URL is set and Postgres schema initialization fails', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/raic');
    vi.doMock('module', () => ({
      createRequire: () =>
        ((id: string) => {
          if (id !== 'postgres') {
            throw new Error(`Unexpected module request: ${id}`);
          }

          return () => ({
            unsafe: vi.fn().mockRejectedValue(new Error('schema init failed')),
          });
        }) as NodeJS.Require,
    }));

    const { getPersistenceMode } = await import('@/lib/db/client');
    await expect(getPersistenceMode()).rejects.toThrow('schema init failed');
  });

  it('preserves all writes when JSON fallback updates overlap', async () => {
    const { updatePlatformStore, readPlatformStore } = await import('@/lib/db/client');
    const now = new Date().toISOString();

    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });

    let secondReady!: () => void;
    const secondReadyPromise = new Promise<void>((resolve) => {
      secondReady = resolve;
    });

    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });

    const firstWrite = updatePlatformStore(async (store) => {
      store.users.push({
        id: 'user-a',
        googleSub: null,
        email: 'a@example.com',
        displayName: 'A',
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      });
      await firstGate;
    });

    const secondWrite = updatePlatformStore(async (store) => {
      store.users.push({
        id: 'user-b',
        googleSub: null,
        email: 'b@example.com',
        displayName: 'B',
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      });
      secondReady();
      await secondGate;
    });

    await Promise.resolve();
    releaseFirst();
    await secondReadyPromise;

    const thirdWrite = updatePlatformStore((store) => {
      store.users.push({
        id: 'user-c',
        googleSub: null,
        email: 'c@example.com',
        displayName: 'C',
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: null,
      });
    });

    releaseSecond();
    await Promise.all([firstWrite, secondWrite, thirdWrite]);

    const store = await readPlatformStore();
    expect(store.users.map((user) => user.id).sort()).toEqual(['user-a', 'user-b', 'user-c']);
  });
});
