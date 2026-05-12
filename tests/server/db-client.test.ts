import path from 'node:path';
import { promises as fs } from 'fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

function setMockPostgresClient(client: MockPostgresExecutor) {
  const globals = globalThis as DbGlobals;
  globals.__raicPlatformSqlClient = client;
}

const originalCwd = process.cwd();
let testRoot = '';
let hostedTempRoot = '';

describe('db client persistence helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    resetDbGlobals();
    testRoot = path.join(
      originalCwd,
      '.vitest-tmp',
      `db-client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    hostedTempRoot = path.join(testRoot, '.hosted-tmp');
    vi.spyOn(process, 'cwd').mockReturnValue(testRoot);
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    resetDbGlobals();
    vi.restoreAllMocks();
    await fs.rm(hostedTempRoot, {
      recursive: true,
      force: true,
    });
    await fs.rm(testRoot, {
      recursive: true,
      force: true,
    });
  });

  it('uses the JSON fallback when DATABASE_URL is unset', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const { getPersistenceMode, updatePlatformStore, readPlatformStore } =
      await import('@/lib/db/client');

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

  it('writes JSON fallback state into the hosted temp data root on serverless runtimes', async () => {
    vi.stubEnv('DATABASE_URL', '');
    vi.stubEnv('VERCEL', '1');
    vi.stubEnv('TMPDIR', hostedTempRoot);
    vi.stubEnv('TMP', hostedTempRoot);
    vi.stubEnv('TEMP', hostedTempRoot);

    const { getPersistenceMode, readPlatformStore, updatePlatformStore } =
      await import('@/lib/db/client');

    expect(await getPersistenceMode()).toBe('json');

    await updatePlatformStore((store) => {
      store.users.push({
        id: 'user-hosted',
        googleSub: null,
        email: 'hosted@example.com',
        displayName: 'Hosted',
        avatarUrl: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        lastLoginAt: null,
      });
    });

    const hostedStorePath = path.join(
      hostedTempRoot,
      'openraic-data',
      'platform',
      'platform-store.json',
    );
    const repoStorePath = path.join(testRoot, 'data', 'platform', 'platform-store.json');

    await expect(fs.readFile(hostedStorePath, 'utf-8')).resolves.toContain('"user-hosted"');
    await expect(fs.readFile(repoStorePath, 'utf-8')).rejects.toMatchObject({ code: 'ENOENT' });

    const store = await readPlatformStore();
    expect(store.users[0]?.id).toBe('user-hosted');
  });

  it('retries transient JSON read lock errors', async () => {
    vi.stubEnv('DATABASE_URL', '');
    const platformDir = path.join(testRoot, 'data', 'platform');
    const platformStorePath = path.join(platformDir, 'platform-store.json');
    await fs.mkdir(platformDir, { recursive: true });
    await fs.writeFile(
      platformStorePath,
      JSON.stringify({
        users: [
          {
            id: 'user-1',
            googleSub: null,
            email: 'teacher@example.com',
            displayName: 'Teacher',
            avatarUrl: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            lastLoginAt: null,
          },
        ],
      }),
      'utf8',
    );

    const actualReadFile = fs.readFile.bind(fs);
    let attempts = 0;
    const readFileSpy = vi.spyOn(fs, 'readFile').mockImplementation(async (pathLike, options) => {
      attempts += 1;
      if (attempts === 1) {
        const error = new Error('platform store locked') as NodeJS.ErrnoException;
        error.code = 'EPERM';
        throw error;
      }

      return (await actualReadFile(pathLike, options as never)) as never;
    });

    const { readPlatformStore } = await import('@/lib/db/client');
    const store = await readPlatformStore();

    expect(store.users[0]?.id).toBe('user-1');
    expect(readFileSpy).toHaveBeenCalledTimes(2);
  });

  it('throws when DATABASE_URL is set and Postgres schema initialization fails', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/raic');
    setMockPostgresClient({
      unsafe: vi.fn().mockRejectedValue(new Error('schema init failed')),
    });

    const { getPersistenceMode } = await import('@/lib/db/client');
    await expect(getPersistenceMode()).rejects.toThrow('schema init failed');
  });

  it('retries schema initialization after a transient failure', async () => {
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/raic');
    const unsafe = vi.fn().mockImplementation(async () => {
      if (unsafe.mock.calls.length === 1) {
        throw new Error('schema init failed');
      }
      return [];
    });
    setMockPostgresClient({ unsafe });

    const { getPersistenceMode } = await import('@/lib/db/client');

    await expect(getPersistenceMode()).rejects.toThrow('schema init failed');
    await expect(getPersistenceMode()).resolves.toBe('postgres');
    expect(unsafe).toHaveBeenCalled();
  });

  it('preserves all writes when JSON fallback updates overlap', async () => {
    // Regression proof that lock ownership is release-safe:
    // a lock can only be released by its owning writer.
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
