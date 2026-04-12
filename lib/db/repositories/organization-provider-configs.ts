import 'server-only';

import { randomUUID } from 'crypto';
import {
  readPlatformStore,
  runPostgresQuery,
  updatePlatformStore,
  type PostgresExecutor,
} from '@/lib/db/client';
import type { OrganizationProviderConfigRecord } from '@/lib/db/schema';
import type { AIProviderDefinition, AIProviderFamily } from '@/lib/types/ai-governance';

interface OrganizationProviderConfigRow {
  id: string;
  organization_id: string;
  family: AIProviderFamily;
  provider_id: string;
  provider_definition: AIProviderDefinition | string | null;
  encrypted_secret: string | null;
  base_url: string | null;
  allowed_models: string[] | string | null;
  default_model: string | null;
  enabled: boolean;
  created_at: string;
  updated_at: string;
}

function parseJsonValue<T>(value: T | string | null, fallback: T): T {
  if (typeof value === 'string') {
    return JSON.parse(value) as T;
  }
  return value ?? fallback;
}

function mapRow(row: OrganizationProviderConfigRow): OrganizationProviderConfigRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    family: row.family,
    providerId: row.provider_id,
    providerDefinition: parseJsonValue<AIProviderDefinition | null>(row.provider_definition, null),
    encryptedSecret: row.encrypted_secret,
    baseUrl: row.base_url,
    allowedModels: parseJsonValue<string[]>(row.allowed_models, []),
    defaultModel: row.default_model,
    enabled: row.enabled,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listOrganizationProviderConfigs(
  organizationId: string,
  family?: AIProviderFamily,
): Promise<OrganizationProviderConfigRecord[]> {
  const rows = await runPostgresQuery<OrganizationProviderConfigRow>(
    `SELECT
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at
     FROM organization_provider_configs
     WHERE organization_id = $1
       AND ($2::text IS NULL OR family = $2)
     ORDER BY family ASC, provider_id ASC`,
    [organizationId, family ?? null],
  );

  if (rows) {
    return rows.map(mapRow);
  }

  const store = await readPlatformStore();
  return store.organizationProviderConfigs.filter(
    (config) => config.organizationId === organizationId && (!family || config.family === family),
  );
}

export async function findOrganizationProviderConfig(
  input: {
    organizationId: string;
    family: AIProviderFamily;
    providerId: string;
  },
  executor?: PostgresExecutor,
): Promise<OrganizationProviderConfigRecord | null> {
  const rows = executor
    ? await executor.unsafe<OrganizationProviderConfigRow>(
        `SELECT
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at
     FROM organization_provider_configs
     WHERE organization_id = $1
       AND family = $2
       AND provider_id = $3
     LIMIT 1`,
        [input.organizationId, input.family, input.providerId],
      )
    : await runPostgresQuery<OrganizationProviderConfigRow>(
        `SELECT
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at
     FROM organization_provider_configs
     WHERE organization_id = $1
       AND family = $2
       AND provider_id = $3
     LIMIT 1`,
        [input.organizationId, input.family, input.providerId],
      );

  if (rows) {
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return (
    store.organizationProviderConfigs.find(
      (config) =>
        config.organizationId === input.organizationId &&
        config.family === input.family &&
        config.providerId === input.providerId,
    ) ?? null
  );
}

export async function upsertOrganizationProviderConfig(
  input: {
    organizationId: string;
    family: AIProviderFamily;
    providerId: string;
    providerDefinition?: AIProviderDefinition | null;
    encryptedSecret?: string | null;
    baseUrl?: string | null;
    allowedModels?: string[];
    defaultModel?: string | null;
    enabled: boolean;
  },
  executor?: PostgresExecutor,
): Promise<OrganizationProviderConfigRecord> {
  const now = new Date().toISOString();
  const allowedModels = input.allowedModels ?? [];

  const rows = executor
    ? await executor.unsafe<OrganizationProviderConfigRow>(
        `INSERT INTO organization_provider_configs (
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, $11, $11)
     ON CONFLICT (organization_id, family, provider_id) DO UPDATE
     SET provider_definition = EXCLUDED.provider_definition,
         encrypted_secret = EXCLUDED.encrypted_secret,
         base_url = EXCLUDED.base_url,
         allowed_models = EXCLUDED.allowed_models,
         default_model = EXCLUDED.default_model,
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at
     RETURNING
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at`,
        [
          randomUUID(),
          input.organizationId,
          input.family,
          input.providerId,
          JSON.stringify(input.providerDefinition ?? null),
          input.encryptedSecret ?? null,
          input.baseUrl ?? null,
          JSON.stringify(allowedModels),
          input.defaultModel ?? null,
          input.enabled,
          now,
        ],
      )
    : await runPostgresQuery<OrganizationProviderConfigRow>(
        `INSERT INTO organization_provider_configs (
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8::jsonb, $9, $10, $11, $11)
     ON CONFLICT (organization_id, family, provider_id) DO UPDATE
     SET provider_definition = EXCLUDED.provider_definition,
         encrypted_secret = EXCLUDED.encrypted_secret,
         base_url = EXCLUDED.base_url,
         allowed_models = EXCLUDED.allowed_models,
         default_model = EXCLUDED.default_model,
         enabled = EXCLUDED.enabled,
         updated_at = EXCLUDED.updated_at
     RETURNING
       id,
       organization_id,
       family,
       provider_id,
       provider_definition,
       encrypted_secret,
       base_url,
       allowed_models,
       default_model,
       enabled,
       created_at,
       updated_at`,
        [
          randomUUID(),
          input.organizationId,
          input.family,
          input.providerId,
          JSON.stringify(input.providerDefinition ?? null),
          input.encryptedSecret ?? null,
          input.baseUrl ?? null,
          JSON.stringify(allowedModels),
          input.defaultModel ?? null,
          input.enabled,
          now,
        ],
      );

  if (rows) {
    return mapRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const existing = store.organizationProviderConfigs.find(
      (config) =>
        config.organizationId === input.organizationId &&
        config.family === input.family &&
        config.providerId === input.providerId,
    );

    if (existing) {
      existing.providerDefinition = input.providerDefinition ?? null;
      existing.encryptedSecret = input.encryptedSecret ?? null;
      existing.baseUrl = input.baseUrl ?? null;
      existing.allowedModels = allowedModels;
      existing.defaultModel = input.defaultModel ?? null;
      existing.enabled = input.enabled;
      existing.updatedAt = now;
      return existing;
    }

    const created: OrganizationProviderConfigRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      family: input.family,
      providerId: input.providerId,
      providerDefinition: input.providerDefinition ?? null,
      encryptedSecret: input.encryptedSecret ?? null,
      baseUrl: input.baseUrl ?? null,
      allowedModels,
      defaultModel: input.defaultModel ?? null,
      enabled: input.enabled,
      createdAt: now,
      updatedAt: now,
    };
    store.organizationProviderConfigs.push(created);
    return created;
  });
}
