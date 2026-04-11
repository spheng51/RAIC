import 'server-only';

import { randomUUID } from 'crypto';
import { readPlatformStore, runPostgresQuery, updatePlatformStore } from '@/lib/db/client';
import type { MembershipRecord, PlatformRole } from '@/lib/db/schema';

interface MembershipRow {
  id: string;
  organization_id: string;
  user_id: string;
  role: PlatformRole;
  created_at: string;
  updated_at: string;
}

function mapMembershipRow(row: MembershipRow): MembershipRecord {
  return {
    id: row.id,
    organizationId: row.organization_id,
    userId: row.user_id,
    role: row.role,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureMembership(input: {
  organizationId: string;
  userId: string;
  role: PlatformRole;
}): Promise<MembershipRecord> {
  const now = new Date().toISOString();

  const rows = await runPostgresQuery<MembershipRow>(
    `INSERT INTO memberships (id, organization_id, user_id, role, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $5)
     ON CONFLICT (organization_id, user_id) DO UPDATE
     SET role = EXCLUDED.role,
         updated_at = EXCLUDED.updated_at
     RETURNING id, organization_id, user_id, role, created_at, updated_at`,
    [randomUUID(), input.organizationId, input.userId, input.role, now],
  );

  if (rows) {
    return mapMembershipRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const existing = store.memberships.find(
      (membership) =>
        membership.organizationId === input.organizationId && membership.userId === input.userId,
    );
    if (existing) {
      existing.role = input.role;
      existing.updatedAt = now;
      return existing;
    }

    const membership: MembershipRecord = {
      id: randomUUID(),
      organizationId: input.organizationId,
      userId: input.userId,
      role: input.role,
      createdAt: now,
      updatedAt: now,
    };
    store.memberships.push(membership);
    return membership;
  });
}

export async function listMembershipsForUser(userId: string): Promise<MembershipRecord[]> {
  const rows = await runPostgresQuery<MembershipRow>(
    `SELECT id, organization_id, user_id, role, created_at, updated_at
     FROM memberships
     WHERE user_id = $1
     ORDER BY created_at ASC`,
    [userId],
  );

  if (rows) {
    return rows.map(mapMembershipRow);
  }

  const store = await readPlatformStore();
  return store.memberships.filter((membership) => membership.userId === userId);
}

export async function findMembershipForUserAndOrganization(
  userId: string,
  organizationId: string,
): Promise<MembershipRecord | null> {
  const rows = await runPostgresQuery<MembershipRow>(
    `SELECT id, organization_id, user_id, role, created_at, updated_at
     FROM memberships
     WHERE user_id = $1 AND organization_id = $2
     LIMIT 1`,
    [userId, organizationId],
  );

  if (rows) {
    return rows[0] ? mapMembershipRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return (
    store.memberships.find(
      (membership) =>
        membership.userId === userId && membership.organizationId === organizationId,
    ) ?? null
  );
}
