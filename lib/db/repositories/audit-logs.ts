import 'server-only';

import { randomUUID } from 'crypto';
import {
  readPlatformStore,
  runPostgresQuery,
  updatePlatformStore,
  type PostgresExecutor,
} from '@/lib/db/client';
import type { AuditLogRecord, PlatformRole } from '@/lib/db/schema';

interface AuditLogRow {
  id: string;
  organization_id: string | null;
  user_id: string | null;
  actor_role: PlatformRole | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  metadata: Record<string, unknown> | string;
  created_at: string;
}

function mapAuditLogRow(row: AuditLogRow): AuditLogRecord {
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

export async function appendAuditLog(
  input: {
    organizationId?: string | null;
    userId?: string | null;
    actorRole?: PlatformRole | null;
    action: string;
    resourceType?: string | null;
    resourceId?: string | null;
    metadata?: Record<string, unknown>;
  },
  executor?: PostgresExecutor,
): Promise<AuditLogRecord> {
  const createdAt = new Date().toISOString();
  const metadata = input.metadata ?? {};

  const rows = executor
    ? await executor.unsafe<AuditLogRow>(
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
      )
    : await runPostgresQuery<AuditLogRow>(
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
    return mapAuditLogRow(rows[0]);
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

export async function findLatestAuditLogByActionAndResource(input: {
  action: string;
  resourceType: string;
  resourceId: string;
}): Promise<AuditLogRecord | null> {
  const rows = await runPostgresQuery<AuditLogRow>(
    `SELECT id, organization_id, user_id, actor_role, action, resource_type, resource_id, metadata, created_at
     FROM audit_logs
     WHERE action = $1
       AND resource_type = $2
       AND resource_id = $3
     ORDER BY created_at DESC
     LIMIT 1`,
    [input.action, input.resourceType, input.resourceId],
  );

  if (rows) {
    return rows[0] ? mapAuditLogRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  for (let index = store.auditLogs.length - 1; index >= 0; index -= 1) {
    const record = store.auditLogs[index];
    if (
      record?.action === input.action &&
      record.resourceType === input.resourceType &&
      record.resourceId === input.resourceId
    ) {
      return record;
    }
  }

  return null;
}
