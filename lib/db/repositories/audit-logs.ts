import 'server-only';

import { randomUUID } from 'crypto';
import { readPlatformStore, runPostgresQuery, updatePlatformStore } from '@/lib/db/client';
import type { AuditLogRecord, PlatformRole } from '@/lib/db/schema';

export async function appendAuditLog(input: {
  organizationId?: string | null;
  userId?: string | null;
  actorRole?: PlatformRole | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<AuditLogRecord> {
  const createdAt = new Date().toISOString();
  const metadata = input.metadata ?? {};

  const rows = await runPostgresQuery<{
    id: string;
    organization_id: string | null;
    user_id: string | null;
    actor_role: PlatformRole | null;
    action: string;
    resource_type: string | null;
    resource_id: string | null;
    metadata: Record<string, unknown> | string;
    created_at: string;
  }>(
    `INSERT INTO audit_logs (
        id,
        organization_id,
        user_id,
        actor_role,
        action,
        resource_type,
        resource_id,
        metadata,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
      RETURNING id, organization_id, user_id, actor_role, action, resource_type, resource_id, metadata, created_at`,
    [
      randomUUID(),
      input.organizationId ?? null,
      input.userId ?? null,
      input.actorRole ?? null,
      input.action,
      input.resourceType ?? null,
      input.resourceId ?? null,
      JSON.stringify(metadata),
      createdAt,
    ],
  );

  if (rows) {
    const row = rows[0];
    return {
      id: row.id,
      organizationId: row.organization_id,
      userId: row.user_id,
      actorRole: row.actor_role,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      metadata: typeof row.metadata === 'string' ? JSON.parse(row.metadata) : row.metadata,
      createdAt: row.created_at,
    };
  }

  return updatePlatformStore((store) => {
    const auditLog: AuditLogRecord = {
      id: randomUUID(),
      organizationId: input.organizationId ?? null,
      userId: input.userId ?? null,
      actorRole: input.actorRole ?? null,
      action: input.action,
      resourceType: input.resourceType ?? null,
      resourceId: input.resourceId ?? null,
      metadata,
      createdAt,
    };
    store.auditLogs.push(auditLog);
    return auditLog;
  });
}
