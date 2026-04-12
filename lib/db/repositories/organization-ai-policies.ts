import 'server-only';

import { randomUUID } from 'crypto';
import {
  readPlatformStore,
  runPostgresQuery,
  updatePlatformStore,
  type PostgresExecutor,
} from '@/lib/db/client';
import type { OrganizationAIPolicyRecord } from '@/lib/db/schema';

interface OrganizationAIPolicyRow {
  id: string;
  organization_id: string;
  allow_personal_overrides: boolean;
  allow_personal_custom_base_urls: boolean;
  created_at: string;
  updated_at: string;
}

function mapRow(row: OrganizationAIPolicyRow): OrganizationAIPolicyRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    allowPersonalOverrides: row.allow_personal_overrides,
    allowPersonalCustomBaseUrls: row.allow_personal_custom_base_urls,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function findOrganizationAIPolicy(
  organizationId: string,
): Promise<OrganizationAIPolicyRecord | null> {
  const rows = await runPostgresQuery<OrganizationAIPolicyRow>(
    `SELECT
       id,
       organization_id,
       allow_personal_overrides,
       allow_personal_custom_base_urls,
       created_at,
       updated_at
     FROM organization_ai_policies
     WHERE organization_id = $1
     LIMIT 1`,
    [organizationId],
  );

  if (rows) {
    return rows[0] ? mapRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return (
    store.organizationAiPolicies.find((policy) => policy.organizationId === organizationId) ?? null
  );
}

export async function upsertOrganizationAIPolicy(input: {
  organizationId: string;
  allowPersonalOverrides: boolean;
  allowPersonalCustomBaseUrls: boolean;
}, executor?: PostgresExecutor): Promise<OrganizationAIPolicyRecord> {
  const now = new Date().toISOString();

  const rows = executor
    ? await executor.unsafe<OrganizationAIPolicyRow>(
        `INSERT INTO organization_ai_policies (
       id,
       organization_id,
       allow_personal_overrides,
       allow_personal_custom_base_urls,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (organization_id) DO UPDATE
     SET allow_personal_overrides = EXCLUDED.allow_personal_overrides,
         allow_personal_custom_base_urls = EXCLUDED.allow_personal_custom_base_urls,
         updated_at = EXCLUDED.updated_at
     RETURNING
       id,
       organization_id,
       allow_personal_overrides,
       allow_personal_custom_base_urls,
       created_at,
       updated_at`,
        [
          randomUUID(),
          input.organizationId,
          input.allowPersonalOverrides,
          input.allowPersonalCustomBaseUrls,
          now,
        ],
      )
    : await runPostgresQuery<OrganizationAIPolicyRow>(
    `INSERT INTO organization_ai_policies (
       id,
       organization_id,
       allow_personal_overrides,
       allow_personal_custom_base_urls,
       created_at,
       updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (organization_id) DO UPDATE
     SET allow_personal_overrides = EXCLUDED.allow_personal_overrides,
         allow_personal_custom_base_urls = EXCLUDED.allow_personal_custom_base_urls,
         updated_at = EXCLUDED.updated_at
     RETURNING
       id,
       organization_id,
       allow_personal_overrides,
       allow_personal_custom_base_urls,
       created_at,
       updated_at`,
    [
      randomUUID(),
      input.organizationId,
      input.allowPersonalOverrides,
      input.allowPersonalCustomBaseUrls,
      now,
    ],
  );

  if (rows) {
    return mapRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const existing = store.organizationAiPolicies.find(
      (policy) => policy.organizationId === input.organizationId,
    );

    if (existing) {
      existing.allowPersonalOverrides = input.allowPersonalOverrides;
      existing.allowPersonalCustomBaseUrls = input.allowPersonalCustomBaseUrls;
      existing.updatedAt = now;
      return existing;
    }

    const created: OrganizationAIPolicyRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      allowPersonalOverrides: input.allowPersonalOverrides,
      allowPersonalCustomBaseUrls: input.allowPersonalCustomBaseUrls,
      createdAt: now,
      updatedAt: now,
    };
    store.organizationAiPolicies.push(created);
    return created;
  });
}
