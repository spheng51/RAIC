import 'server-only';

import { randomUUID } from 'crypto';
import { readPlatformStore, runPostgresQuery, updatePlatformStore } from '@/lib/db/client';
import type { PlatformRole, SessionKind, SessionRecord } from '@/lib/db/schema';

interface SessionRow {
  id: string;
  user_id: string;
  organization_id: string | null;
  classroom_id: string | null;
  role: PlatformRole;
  kind: SessionKind;
  token_hash: string;
  user_agent: string | null;
  ip_address: string | null;
  created_at: string;
  updated_at: string;
  last_seen_at: string;
  expires_at: string;
  absolute_expires_at: string;
  revoked_at: string | null;
}

function mapSessionRow(row: SessionRow): SessionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    organizationId: row.organization_id,
    classroomId: row.classroom_id,
    role: row.role,
    kind: row.kind,
    tokenHash: row.token_hash,
    userAgent: row.user_agent,
    ipAddress: row.ip_address,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at,
    absoluteExpiresAt: row.absolute_expires_at,
    revokedAt: row.revoked_at,
  };
}

export async function createSessionRecord(input: {
  userId: string;
  organizationId: string | null;
  classroomId?: string | null;
  role: PlatformRole;
  kind: SessionKind;
  tokenHash: string;
  userAgent?: string | null;
  ipAddress?: string | null;
  expiresAt: string;
  absoluteExpiresAt: string;
}): Promise<SessionRecord> {
  const now = new Date().toISOString();

  const rows = await runPostgresQuery<SessionRow>(
    `INSERT INTO sessions (
        id,
        user_id,
        organization_id,
        classroom_id,
        role,
        kind,
        token_hash,
        user_agent,
        ip_address,
        created_at,
        updated_at,
        last_seen_at,
        expires_at,
        absolute_expires_at,
        revoked_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10, $10, $11, $12, NULL)
      RETURNING id, user_id, organization_id, classroom_id, role, kind, token_hash, user_agent, ip_address,
                created_at, updated_at, last_seen_at, expires_at, absolute_expires_at, revoked_at`,
    [
      randomUUID(),
      input.userId,
      input.organizationId,
      input.classroomId ?? null,
      input.role,
      input.kind,
      input.tokenHash,
      input.userAgent ?? null,
      input.ipAddress ?? null,
      now,
      input.expiresAt,
      input.absoluteExpiresAt,
    ],
  );

  if (rows) {
    return mapSessionRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const session: SessionRecord = {
      id: randomUUID(),
      userId: input.userId,
      organizationId: input.organizationId,
      classroomId: input.classroomId ?? null,
      role: input.role,
      kind: input.kind,
      tokenHash: input.tokenHash,
      userAgent: input.userAgent ?? null,
      ipAddress: input.ipAddress ?? null,
      createdAt: now,
      updatedAt: now,
      lastSeenAt: now,
      expiresAt: input.expiresAt,
      absoluteExpiresAt: input.absoluteExpiresAt,
      revokedAt: null,
    };
    store.sessions.push(session);
    return session;
  });
}

export async function findSessionByTokenHash(tokenHash: string): Promise<SessionRecord | null> {
  const rows = await runPostgresQuery<SessionRow>(
    `SELECT id, user_id, organization_id, classroom_id, role, kind, token_hash, user_agent, ip_address,
            created_at, updated_at, last_seen_at, expires_at, absolute_expires_at, revoked_at
     FROM sessions
     WHERE token_hash = $1
     LIMIT 1`,
    [tokenHash],
  );

  if (rows) {
    return rows[0] ? mapSessionRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.sessions.find((session) => session.tokenHash === tokenHash) ?? null;
}

export async function findSessionById(sessionId: string): Promise<SessionRecord | null> {
  const rows = await runPostgresQuery<SessionRow>(
    `SELECT id, user_id, organization_id, classroom_id, role, kind, token_hash, user_agent, ip_address,
            created_at, updated_at, last_seen_at, expires_at, absolute_expires_at, revoked_at
     FROM sessions
     WHERE id = $1
     LIMIT 1`,
    [sessionId],
  );

  if (rows) {
    return rows[0] ? mapSessionRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return store.sessions.find((session) => session.id === sessionId) ?? null;
}

export async function listRecentClassroomSessions(
  classroomId: string,
  maxInactiveMs = 30_000,
): Promise<SessionRecord[]> {
  const cutoffIso = new Date(Date.now() - maxInactiveMs).toISOString();
  const nowIso = new Date().toISOString();
  const rows = await runPostgresQuery<SessionRow>(
    `SELECT id, user_id, organization_id, classroom_id, role, kind, token_hash, user_agent, ip_address,
            created_at, updated_at, last_seen_at, expires_at, absolute_expires_at, revoked_at
     FROM sessions
     WHERE classroom_id = $1
       AND kind = 'classroom'
       AND revoked_at IS NULL
       AND expires_at > $2
       AND absolute_expires_at > $2
       AND last_seen_at >= $3
     ORDER BY last_seen_at DESC`,
    [classroomId, nowIso, cutoffIso],
  );

  if (rows) {
    return rows.map(mapSessionRow);
  }

  const store = await readPlatformStore();
  const cutoff = new Date(cutoffIso).getTime();
  const now = new Date(nowIso).getTime();
  return store.sessions
    .filter((session) => {
      if (
        session.classroomId !== classroomId ||
        session.kind !== 'classroom' ||
        session.revokedAt
      ) {
        return false;
      }
      const expiresAt = new Date(session.expiresAt).getTime();
      const absoluteExpiresAt = new Date(session.absoluteExpiresAt).getTime();
      const lastSeenAt = new Date(session.lastSeenAt).getTime();
      return expiresAt > now && absoluteExpiresAt > now && lastSeenAt >= cutoff;
    })
    .sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
}

export async function touchSession(
  sessionId: string,
  updates: Pick<SessionRecord, 'lastSeenAt' | 'expiresAt'>,
): Promise<void> {
  const now = new Date().toISOString();

  const rows = await runPostgresQuery<SessionRow>(
    `UPDATE sessions
     SET last_seen_at = $2,
         expires_at = $3,
         updated_at = $4
     WHERE id = $1
     RETURNING id, user_id`,
    [sessionId, updates.lastSeenAt, updates.expiresAt, now],
  );

  if (rows) return;

  await updatePlatformStore((store) => {
    const session = store.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    session.lastSeenAt = updates.lastSeenAt;
    session.expiresAt = updates.expiresAt;
    session.updatedAt = now;
  });
}

export async function revokeSessionById(sessionId: string): Promise<void> {
  const now = new Date().toISOString();

  const rows = await runPostgresQuery<SessionRow>(
    `UPDATE sessions
     SET revoked_at = $2,
         updated_at = $2
     WHERE id = $1
     RETURNING id, user_id`,
    [sessionId, now],
  );

  if (rows) return;

  await updatePlatformStore((store) => {
    const session = store.sessions.find((candidate) => candidate.id === sessionId);
    if (!session) return;
    session.revokedAt = now;
    session.updatedAt = now;
  });
}
