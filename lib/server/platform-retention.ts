import 'server-only';

import {
  getPersistenceMode,
  readPlatformStore,
  runPostgresQuery,
  runPostgresTransaction,
  updatePlatformStore,
  type PersistenceMode,
} from '@/lib/db/client';
import type { PlatformStore } from '@/lib/db/schema';

export interface PlatformRetentionPolicy {
  staleSessionRetentionDays: number;
  expiredJoinTokenRetentionDays: number;
  guestUserRetentionDays: number;
  auditLogRetentionDays: number;
}

export interface PlatformRetentionCounts {
  sessions: number;
  joinTokens: number;
  guestUsers: number;
  auditLogs: number;
}

export interface PlatformRetentionRunResult {
  dryRun: boolean;
  mode: PersistenceMode;
  now: string;
  policy: PlatformRetentionPolicy;
  candidates: PlatformRetentionCounts;
  deleted: PlatformRetentionCounts;
}

interface PlatformRetentionCandidateIds {
  sessionIds: string[];
  joinTokenIds: string[];
  guestUserIds: string[];
  auditLogIds: string[];
}

interface PlatformRetentionCutoffs {
  sessionCutoffIso: string;
  joinTokenCutoffIso: string;
  guestUserCutoffIso: string;
  auditLogCutoffIso: string;
}

const EMPTY_COUNTS: PlatformRetentionCounts = {
  sessions: 0,
  joinTokens: 0,
  guestUsers: 0,
  auditLogs: 0,
};

export const DEFAULT_PLATFORM_RETENTION_POLICY: PlatformRetentionPolicy = {
  staleSessionRetentionDays: 7,
  expiredJoinTokenRetentionDays: 2,
  guestUserRetentionDays: 7,
  auditLogRetentionDays: 90,
};

function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
  label: keyof PlatformRetentionPolicy,
) {
  if (value === undefined) {
    return fallback;
  }

  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${label} must be a positive integer`);
  }

  return Math.floor(value);
}

export function resolvePlatformRetentionPolicy(
  input: Partial<PlatformRetentionPolicy> = {},
): PlatformRetentionPolicy {
  return {
    staleSessionRetentionDays: resolvePositiveInteger(
      input.staleSessionRetentionDays,
      DEFAULT_PLATFORM_RETENTION_POLICY.staleSessionRetentionDays,
      'staleSessionRetentionDays',
    ),
    expiredJoinTokenRetentionDays: resolvePositiveInteger(
      input.expiredJoinTokenRetentionDays,
      DEFAULT_PLATFORM_RETENTION_POLICY.expiredJoinTokenRetentionDays,
      'expiredJoinTokenRetentionDays',
    ),
    guestUserRetentionDays: resolvePositiveInteger(
      input.guestUserRetentionDays,
      DEFAULT_PLATFORM_RETENTION_POLICY.guestUserRetentionDays,
      'guestUserRetentionDays',
    ),
    auditLogRetentionDays: resolvePositiveInteger(
      input.auditLogRetentionDays,
      DEFAULT_PLATFORM_RETENTION_POLICY.auditLogRetentionDays,
      'auditLogRetentionDays',
    ),
  };
}

function toCutoffIso(nowMs: number, days: number) {
  return new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();
}

function buildCutoffs(policy: PlatformRetentionPolicy, nowIso: string): PlatformRetentionCutoffs {
  const nowMs = new Date(nowIso).getTime();
  return {
    sessionCutoffIso: toCutoffIso(nowMs, policy.staleSessionRetentionDays),
    joinTokenCutoffIso: toCutoffIso(nowMs, policy.expiredJoinTokenRetentionDays),
    guestUserCutoffIso: toCutoffIso(nowMs, policy.guestUserRetentionDays),
    auditLogCutoffIso: toCutoffIso(nowMs, policy.auditLogRetentionDays),
  };
}

function isOlderThan(timestamp: string | null | undefined, cutoffMs: number) {
  if (!timestamp) return false;
  const parsed = new Date(timestamp).getTime();
  return !Number.isNaN(parsed) && parsed <= cutoffMs;
}

function isClassroomGuestEmail(email: string) {
  return email.trim().toLowerCase().endsWith('@classroom.raic.local');
}

function collectJsonCandidateIds(
  store: PlatformStore,
  cutoffs: PlatformRetentionCutoffs,
): PlatformRetentionCandidateIds {
  const sessionCutoffMs = new Date(cutoffs.sessionCutoffIso).getTime();
  const joinTokenCutoffMs = new Date(cutoffs.joinTokenCutoffIso).getTime();
  const guestUserCutoffMs = new Date(cutoffs.guestUserCutoffIso).getTime();
  const auditLogCutoffMs = new Date(cutoffs.auditLogCutoffIso).getTime();

  const staleSessionIds = new Set(
    store.sessions
      .filter((session) => {
        if (isOlderThan(session.revokedAt, sessionCutoffMs)) {
          return true;
        }

        return (
          isOlderThan(session.expiresAt, sessionCutoffMs) ||
          isOlderThan(session.absoluteExpiresAt, sessionCutoffMs)
        );
      })
      .map((session) => session.id),
  );

  const joinTokenIds = new Set(
    store.joinTokens
      .filter((joinToken) => {
        // v1 join links stay reusable until expiry, so cleanup is based on expiry
        // rather than first redemption. consumedAt remains reserved for a future
        // single-use contract if product requirements change.
        return (
          isOlderThan(joinToken.expiresAt, joinTokenCutoffMs) ||
          isOlderThan(joinToken.consumedAt, joinTokenCutoffMs)
        );
      })
      .map((joinToken) => joinToken.id),
  );

  const guestUserIds = new Set(
    store.users
      .filter((user) => {
        if (user.googleSub !== null || !isClassroomGuestEmail(user.email)) {
          return false;
        }

        const updatedAt = new Date(user.updatedAt).getTime();
        if (Number.isNaN(updatedAt) || updatedAt > guestUserCutoffMs) {
          return false;
        }

        return !store.sessions.some(
          (session) => session.userId === user.id && !staleSessionIds.has(session.id),
        );
      })
      .map((user) => user.id),
  );

  const auditLogIds = new Set(
    store.auditLogs
      .filter((auditLog) => isOlderThan(auditLog.createdAt, auditLogCutoffMs))
      .map((auditLog) => auditLog.id),
  );

  return {
    sessionIds: [...staleSessionIds],
    joinTokenIds: [...joinTokenIds],
    guestUserIds: [...guestUserIds],
    auditLogIds: [...auditLogIds],
  };
}

interface IdRow {
  id: string;
}

async function selectPostgresIds(query: string, params: unknown[]): Promise<string[]> {
  const rows = await runPostgresQuery<IdRow>(query, params);
  return rows?.map((row) => row.id) ?? [];
}

async function collectPostgresCandidateIds(
  cutoffs: PlatformRetentionCutoffs,
): Promise<PlatformRetentionCandidateIds> {
  const sessionIds = await selectPostgresIds(
    `SELECT id
     FROM sessions
     WHERE (revoked_at IS NOT NULL AND revoked_at <= $1)
        OR expires_at <= $1
        OR absolute_expires_at <= $1`,
    [cutoffs.sessionCutoffIso],
  );

  const joinTokenIds = await selectPostgresIds(
    `SELECT id
     FROM join_tokens
     WHERE expires_at <= $1
        OR (consumed_at IS NOT NULL AND consumed_at <= $1)`,
    [cutoffs.joinTokenCutoffIso],
  );

  const guestUserIds = await selectPostgresIds(
    `SELECT u.id
     FROM users u
     WHERE u.google_sub IS NULL
       AND lower(u.email) LIKE '%@classroom.raic.local'
       AND u.updated_at <= $1
       AND NOT EXISTS (
         SELECT 1
         FROM sessions s
         WHERE s.user_id = u.id
           AND NOT (
             (s.revoked_at IS NOT NULL AND s.revoked_at <= $2)
             OR s.expires_at <= $2
             OR s.absolute_expires_at <= $2
           )
       )`,
    [cutoffs.guestUserCutoffIso, cutoffs.sessionCutoffIso],
  );

  const auditLogIds = await selectPostgresIds(
    `SELECT id
     FROM audit_logs
     WHERE created_at <= $1`,
    [cutoffs.auditLogCutoffIso],
  );

  return {
    sessionIds,
    joinTokenIds,
    guestUserIds,
    auditLogIds,
  };
}

function countsFromCandidateIds(
  candidateIds: PlatformRetentionCandidateIds,
): PlatformRetentionCounts {
  return {
    sessions: candidateIds.sessionIds.length,
    joinTokens: candidateIds.joinTokenIds.length,
    guestUsers: candidateIds.guestUserIds.length,
    auditLogs: candidateIds.auditLogIds.length,
  };
}

async function deleteJsonCandidates(candidateIds: PlatformRetentionCandidateIds) {
  const sessionIds = new Set(candidateIds.sessionIds);
  const joinTokenIds = new Set(candidateIds.joinTokenIds);
  const guestUserIds = new Set(candidateIds.guestUserIds);
  const auditLogIds = new Set(candidateIds.auditLogIds);

  await updatePlatformStore((store) => {
    store.sessions = store.sessions.filter((session) => !sessionIds.has(session.id));
    store.joinTokens = store.joinTokens.filter((joinToken) => !joinTokenIds.has(joinToken.id));
    store.auditLogs = store.auditLogs.filter((auditLog) => !auditLogIds.has(auditLog.id));
    store.memberships = store.memberships.filter(
      (membership) => !guestUserIds.has(membership.userId),
    );
    store.memberships = store.memberships.filter(
      (membership) => !guestUserIds.has(membership.userId),
    );
    store.users = store.users.filter((user) => !guestUserIds.has(user.id));
  });
}

async function deletePostgresCandidates(candidateIds: PlatformRetentionCandidateIds) {
  await runPostgresTransaction(async (executor) => {
    if (candidateIds.sessionIds.length > 0) {
      await executor.unsafe(`DELETE FROM sessions WHERE id = ANY($1::text[])`, [
        candidateIds.sessionIds,
      ]);
    }

    if (candidateIds.joinTokenIds.length > 0) {
      await executor.unsafe(`DELETE FROM join_tokens WHERE id = ANY($1::text[])`, [
        candidateIds.joinTokenIds,
      ]);
    }

    if (candidateIds.auditLogIds.length > 0) {
      await executor.unsafe(`DELETE FROM audit_logs WHERE id = ANY($1::text[])`, [
        candidateIds.auditLogIds,
      ]);
    }

    if (candidateIds.guestUserIds.length > 0) {
      await executor.unsafe(`DELETE FROM users WHERE id = ANY($1::text[])`, [
        candidateIds.guestUserIds,
      ]);
    }
  });
}

export async function runPlatformRetentionCleanup(input?: {
  dryRun?: boolean;
  now?: string;
  policy?: Partial<PlatformRetentionPolicy>;
}): Promise<PlatformRetentionRunResult> {
  const dryRun = input?.dryRun ?? true;
  const now = input?.now ?? new Date().toISOString();
  const policy = resolvePlatformRetentionPolicy(input?.policy);
  const cutoffs = buildCutoffs(policy, now);
  const mode = await getPersistenceMode();

  const candidateIds =
    mode === 'postgres'
      ? await collectPostgresCandidateIds(cutoffs)
      : collectJsonCandidateIds(await readPlatformStore(), cutoffs);
  const candidates = countsFromCandidateIds(candidateIds);

  if (dryRun) {
    return {
      dryRun,
      mode,
      now,
      policy,
      candidates,
      deleted: { ...EMPTY_COUNTS },
    };
  }

  if (mode === 'postgres') {
    await deletePostgresCandidates(candidateIds);
  } else {
    await deleteJsonCandidates(candidateIds);
  }

  return {
    dryRun,
    mode,
    now,
    policy,
    candidates,
    deleted: { ...candidates },
  };
}
