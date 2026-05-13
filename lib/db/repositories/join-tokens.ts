import 'server-only';

import { randomUUID } from 'crypto';
import { readPlatformStore, runPostgresQuery, updatePlatformStore } from '@/lib/db/client';
import type { JoinTokenRecord } from '@/lib/db/schema';

interface JoinTokenRow {
  id: string;
  classroom_id: string;
  created_by_user_id: string;
  organization_id: string | null;
  display_name: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  consumed_at: string | null;
}

function mapJoinTokenRow(row: JoinTokenRow): JoinTokenRecord {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    createdByUserId: row.created_by_user_id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    tokenHash: row.token_hash,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    consumedAt: row.consumed_at,
  };
}

export async function createJoinTokenRecord(input: {
  classroomId: string;
  createdByUserId: string;
  organizationId: string | null;
  displayName: string;
  tokenHash: string;
  expiresAt: string;
}): Promise<JoinTokenRecord> {
  const now = new Date().toISOString();
  const rows = await runPostgresQuery<JoinTokenRow>(
    `INSERT INTO join_tokens (
        id,
        classroom_id,
        created_by_user_id,
        organization_id,
        display_name,
        token_hash,
        created_at,
        expires_at,
        consumed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NULL)
      RETURNING id, classroom_id, created_by_user_id, organization_id, display_name,
                token_hash, created_at, expires_at, consumed_at`,
    [
      randomUUID(),
      input.classroomId,
      input.createdByUserId,
      input.organizationId,
      input.displayName,
      input.tokenHash,
      now,
      input.expiresAt,
    ],
  );

  if (rows) {
    return mapJoinTokenRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const joinToken: JoinTokenRecord = {
      id: randomUUID(),
      classroomId: input.classroomId,
      createdByUserId: input.createdByUserId,
      organizationId: input.organizationId,
      displayName: input.displayName,
      tokenHash: input.tokenHash,
      createdAt: now,
      expiresAt: input.expiresAt,
      consumedAt: null,
    };
    store.joinTokens.push(joinToken);
    return joinToken;
  });
}

export async function findJoinTokenByHash(tokenHash: string): Promise<JoinTokenRecord | null> {
  const rows = await runPostgresQuery<JoinTokenRow>(
    `SELECT id, classroom_id, created_by_user_id, organization_id, display_name, token_hash,
            created_at, expires_at, consumed_at
     FROM join_tokens
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  if (rows) {
    return rows[0] ? mapJoinTokenRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.joinTokens.find((joinToken) => joinToken.tokenHash === tokenHash) ?? null;
}

export async function updateJoinTokenExpiration(
  id: string,
  expiresAt: string,
): Promise<JoinTokenRecord | null> {
  const rows = await runPostgresQuery<JoinTokenRow>(
    `UPDATE join_tokens
     SET expires_at = $2
     WHERE id = $1
     RETURNING id, classroom_id, created_by_user_id, organization_id, display_name,
               token_hash, created_at, expires_at, consumed_at`,
    [id, expiresAt],
  );

  if (rows) {
    return rows[0] ? mapJoinTokenRow(rows[0]) : null;
  }

  return updatePlatformStore((store) => {
    const joinToken = store.joinTokens.find((entry) => entry.id === id);
    if (!joinToken) {
      return null;
    }

    joinToken.expiresAt = expiresAt;
    return joinToken;
  });
}
