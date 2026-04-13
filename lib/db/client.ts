import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { EMPTY_PLATFORM_STORE, PLATFORM_SCHEMA_SQL, type PlatformStore } from '@/lib/db/schema';
import { writeJsonFileAtomic } from '@/lib/server/classroom-storage';

const runtimeRequire = createRequire(import.meta.url);
const PLATFORM_DATA_DIR = path.join(process.cwd(), 'data', 'platform');
const PLATFORM_STORE_PATH = path.join(PLATFORM_DATA_DIR, 'platform-store.json');
const TRANSIENT_PLATFORM_READ_CODES = new Set(['EPERM', 'EBUSY', 'ENOENT']);
const PLATFORM_READ_RETRY_COUNT = 5;

export type PostgresExecutor = {
  unsafe<T>(query: string, params?: unknown[]): Promise<T[]>;
  begin?<T>(handler: (executor: PostgresExecutor) => Promise<T>): Promise<T>;
};

export type PersistenceMode = 'postgres' | 'json';

declare global {
  var __raicPlatformSqlClient: PostgresExecutor | undefined;
  var __raicPlatformSchemaPromise: Promise<void> | undefined;
  var __raicPlatformJsonLock: Promise<void> | undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizePlatformStore(value: unknown): PlatformStore {
  if (!isPlainObject(value)) return structuredClone(EMPTY_PLATFORM_STORE);

  const users = Array.isArray(value.users) ? value.users : [];
  const organizations = Array.isArray(value.organizations) ? value.organizations : [];
  const memberships = Array.isArray(value.memberships) ? value.memberships : [];
  const sessions = Array.isArray(value.sessions) ? value.sessions : [];
  const joinTokens = Array.isArray(value.joinTokens) ? value.joinTokens : [];
  const auditLogs = Array.isArray(value.auditLogs) ? value.auditLogs : [];
  const organizationAiPolicies = Array.isArray(value.organizationAiPolicies)
    ? value.organizationAiPolicies
    : [];
  const organizationProviderConfigs = Array.isArray(value.organizationProviderConfigs)
    ? value.organizationProviderConfigs
    : [];
  const userProviderOverrides = Array.isArray(value.userProviderOverrides)
    ? value.userProviderOverrides
    : [];

  return {
    users,
    organizations,
    memberships,
    sessions,
    joinTokens,
    auditLogs,
    organizationAiPolicies,
    organizationProviderConfigs,
    userProviderOverrides,
  } as PlatformStore;
}

async function ensurePlatformDataDir() {
  await fs.mkdir(PLATFORM_DATA_DIR, { recursive: true });
}

async function waitForRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, attempt * 50));
}

function getDatabaseUrl() {
  return process.env.DATABASE_URL?.trim() || null;
}

export function isPostgresConfigured() {
  return getDatabaseUrl() !== null;
}

async function getPostgresClient(): Promise<PostgresExecutor | null> {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) return null;

  if (!globalThis.__raicPlatformSqlClient) {
    let postgresFactory:
      | ((url: string, options?: Record<string, unknown>) => PostgresExecutor)
      | null = null;
    try {
      postgresFactory = runtimeRequire('postgres') as (
        url: string,
        options?: Record<string, unknown>,
      ) => PostgresExecutor;
    } catch (error) {
      throw new Error(
        `DATABASE_URL is configured, but the "postgres" driver could not be loaded: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    if (!postgresFactory) {
      throw new Error('DATABASE_URL is configured, but the "postgres" driver is unavailable');
    }

    globalThis.__raicPlatformSqlClient = postgresFactory(databaseUrl, {
      max: 1,
      prepare: false,
      idle_timeout: 5,
      connect_timeout: 10,
      transform: {
        undefined: null,
      },
    });
  }

  return globalThis.__raicPlatformSqlClient;
}

async function ensurePostgresSchema() {
  if (!isPostgresConfigured()) return;

  if (!globalThis.__raicPlatformSchemaPromise) {
    globalThis.__raicPlatformSchemaPromise = (async () => {
      const client = await getPostgresClient();
      if (!client) {
        throw new Error('DATABASE_URL is configured, but no Postgres client is available');
      }

      for (const statement of PLATFORM_SCHEMA_SQL) {
        await client.unsafe(statement);
      }
    })().catch((error) => {
      globalThis.__raicPlatformSchemaPromise = undefined;
      throw error;
    });
  }

  await globalThis.__raicPlatformSchemaPromise;
}

export async function getPersistenceMode(): Promise<PersistenceMode> {
  if (!isPostgresConfigured()) {
    return 'json';
  }

  await ensurePostgresSchema();
  return 'postgres';
}

export async function runPostgresQuery<T>(
  query: string,
  params: unknown[] = [],
): Promise<T[] | null> {
  if (!isPostgresConfigured()) return null;
  await ensurePostgresSchema();
  const client = await getPostgresClient();
  if (!client) {
    throw new Error('DATABASE_URL is configured, but no Postgres client is available');
  }
  return client.unsafe<T>(query, params);
}

export async function runPostgresTransaction<T>(
  handler: (executor: PostgresExecutor) => Promise<T>,
): Promise<T | null> {
  if (!isPostgresConfigured()) return null;
  await ensurePostgresSchema();
  const client = await getPostgresClient();
  if (!client) {
    throw new Error('DATABASE_URL is configured, but no Postgres client is available');
  }

  if (typeof client.begin !== 'function') {
    return handler(client);
  }

  return client.begin((executor) => handler(executor));
}

export async function readPlatformStore(): Promise<PlatformStore> {
  await ensurePlatformDataDir();
  for (let attempt = 1; attempt <= PLATFORM_READ_RETRY_COUNT; attempt += 1) {
    try {
      const content = await fs.readFile(PLATFORM_STORE_PATH, 'utf-8');
      return normalizePlatformStore(JSON.parse(content));
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ENOENT' && attempt >= PLATFORM_READ_RETRY_COUNT) {
        return structuredClone(EMPTY_PLATFORM_STORE);
      }
      if (TRANSIENT_PLATFORM_READ_CODES.has(code ?? '') && attempt < PLATFORM_READ_RETRY_COUNT) {
        await waitForRetry(attempt);
        continue;
      }
      throw error;
    }
  }

  return structuredClone(EMPTY_PLATFORM_STORE);
}

export async function updatePlatformStore<T>(
  updater: (store: PlatformStore) => Promise<T> | T,
): Promise<T> {
  const previous = globalThis.__raicPlatformJsonLock ?? Promise.resolve();

  let release: () => void;
  const currentLock = new Promise<void>((resolve) => {
    release = resolve;
  });
  globalThis.__raicPlatformJsonLock = currentLock;

  try {
    await previous;
    const store = await readPlatformStore();
    const result = await updater(store);
    await writeJsonFileAtomic(PLATFORM_STORE_PATH, store);
    return result;
  } finally {
    release!();
    if (globalThis.__raicPlatformJsonLock === currentLock) {
      globalThis.__raicPlatformJsonLock = undefined;
    }
  }
}
