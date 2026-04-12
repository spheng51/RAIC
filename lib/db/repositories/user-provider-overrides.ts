import 'server-only';

import { randomUUID } from 'crypto';
import {
  readPlatformStore,
  runPostgresQuery,
  updatePlatformStore,
  type PostgresExecutor,
} from '@/lib/db/client';
import type { UserProviderOverrideRecord } from '@/lib/db/schema';
import type { AIProviderFamily } from '@/lib/types/ai-governance';

interface UserProviderOverrideRow {
  id: string;
  organization_id: string;
  user_id: string;
  family: AIProviderFamily;
  provider_id: string;
  encrypted_secret: string | null;
  base_url: string | null;
  preferred_model: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: UserProviderOverrideRow): UserProviderOverrideRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    family: row.family,
    providerId: row.provider_id,
    encryptedSecret: row.encrypted_secret,
    baseUrl: row.base_url,
    preferredModel: row.preferred_model,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listUserProviderOverrides(input: {
  organizationId: string;
  userId: string;
  family?: AIProviderFamily;
}): Promise<UserProviderOverrideRecord[]> {
  const rows = await runPostgresQuery<UserProviderOverrideRow>(
    `SELECT
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at
     FROM user_provider_overrides
     WHERE organization_id = $1
       AND user_id = $2
       AND ($3::text IS NULL OR family = $3)
     ORDER BY family ASC, provider_id ASC`,
    [input.organizationId, input.userId, input.family ?? null],
  );

  if (rows) {
    return rows.map(mapRow);
  }

  const store = await readPlatformStore();
  return store.userProviderOverrides.filter(
    (override) =>
      override.organizationId === input.organizationId &&
      override.userId === input.userId &&
      (!input.family || override.family === input.family),
  );
}

export async function findUserProviderOverride(
  input: {
    organizationId: string;
    userId: string;
    family: AIProviderFamily;
    providerId: string;
  },
  executor?: PostgresExecutor,
): Promise<UserProviderOverrideRecord | null> {
  const rows = executor
    ? await executor.unsafe<UserProviderOverrideRow>(
        `SELECT
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at
     FROM user_provider_overrides
     WHERE organization_id = $1
       AND user_id = $2
       AND family = $3
       AND provider_id = $4
     LIMIT 1`,
        [input.organizationId, input.userId, input.family, input.providerId],
      )
    : await runPostgresQuery<UserProviderOverrideRow>(
        `SELECT
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at
     FROM user_provider_overrides
     WHERE organization_id = $1
       AND user_id = $2
       AND family = $3
       AND provider_id = $4
     LIMIT 1`,
        [input.organizationId, input.userId, input.family, input.providerId],
      );

  if (rows) {
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return (
    store.userProviderOverrides.find(
      (override) =>
        override.organizationId === input.organizationId &&
        override.userId === input.userId &&
        override.family === input.family &&
        override.providerId === input.providerId,
    ) ?? null
  );
}

export async function upsertUserProviderOverride(
  input: {
    organizationId: string;
    userId: string;
    family: AIProviderFamily;
    providerId: string;
    encryptedSecret?: string | null;
    baseUrl?: string | null;
    preferredModel?: string | null;
    enabled: boolean;
  },
  executor?: PostgresExecutor,
): Promise<UserProviderOverrideRecord> {
  const now = new Date().toISOString();

  const rows = executor
    ? await executor.unsafe<UserProviderOverrideRow>(
        `INSERT INTO user_provider_overrides (
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (organization_id, user_id, family, provider_id) DO UPDATE
     SET encrypted_secret = EXCLUDED.encrypted_secret,
         base_url = EXCLUDED.base_url,
         preferred_model = EXCLUDED.preferred_model,
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at
     RETURNING
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at`,
        [
          randomUUID(),
          input.organizationId,
          input.userId,
          input.family,
          input.providerId,
          input.encryptedSecret ?? null,
          input.baseUrl ?? null,
          input.preferredModel ?? null,
          input.enabled,
          now,
        ],
      )
    : await runPostgresQuery<UserProviderOverrideRow>(
        `INSERT INTO user_provider_overrides (
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
     ON CONFLICT (organization_id, user_id, family, provider_id) DO UPDATE
     SET encrypted_secret = EXCLUDED.encrypted_secret,
         base_url = EXCLUDED.base_url,
         preferred_model = EXCLUDED.preferred_model,
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at
     RETURNING
       id,
       organization_id,
       user_id,
       family,
       provider_id,
       encrypted_secret,
       base_url,
       preferred_model,
       enabled,
       created_at,
       updated_at`,
        [
          randomUUID(),
          input.organizationId,
          input.userId,
          input.family,
          input.providerId,
          input.encryptedSecret ?? null,
          input.baseUrl ?? null,
          input.preferredModel ?? null,
          input.enabled,
          now,
        ],
      );

  if (rows) {
    return mapRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const existing = store.userProviderOverrides.find(
      (override) =>
        override.organizationId === input.organizationId &&
        override.userId === input.userId &&
        override.family === input.family &&
        override.providerId === input.providerId,
    );

    if (existing) {
      existing.encryptedSecret = input.encryptedSecret ?? null;
      existing.baseUrl = input.baseUrl ?? null;
      existing.preferredModel = input.preferredModel ?? null;
      existing.enabled = input.enabled;
      existing.updatedAt = now;
      return existing;
    }

    const created: UserProviderOverrideRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      family: input.family,
      providerId: input.providerId,
      encryptedSecret: input.encryptedSecret ?? null,
      baseUrl: input.baseUrl ?? null,
      preferredModel: input.preferredModel ?? null,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };
    store.userProviderOverrides.push(created);
    return created;
  });
}
