import 'server-only';

import { runPostgresQuery } from '@/lib/db/client';
import type { PlatformRole, ScheduledClassEventRecord } from '@/lib/db/schema';
import type {
  ScheduledClassDiscordSync,
  ScheduledClassMultiplayerGame,
} from '@/lib/types/scheduled-classes';

interface ScheduledClassEventRow {
  id: string;
  owner_user_id: string | null;
  organization_id: string | null;
  title: string;
  starts_at: string | Date;
  duration_minutes: number | null;
  classroom_id: string | null;
  multiplayer_game: ScheduledClassMultiplayerGame | null;
  discord_sync: ScheduledClassDiscordSync | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const SCHEDULED_CLASS_COLUMNS = `
  id,
  owner_user_id,
  organization_id,
  title,
  starts_at,
  duration_minutes,
  classroom_id,
  multiplayer_game,
  discord_sync,
  created_at,
  updated_at
`;

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapScheduledClassEventRow(row: ScheduledClassEventRow): ScheduledClassEventRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    title: row.title,
    startsAt: toIso(row.starts_at),
    ...(row.duration_minutes ? { durationMinutes: row.duration_minutes } : {}),
    ...(row.classroom_id ? { classroomId: row.classroom_id } : {}),
    ...(row.multiplayer_game ? { multiplayerGame: row.multiplayer_game } : {}),
    ...(row.discord_sync ? { discordSync: row.discord_sync } : {}),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

export async function listScheduledClassEventRecordsForAccess(input: {
  role: PlatformRole;
  userId: string;
  organizationId?: string | null;
}): Promise<ScheduledClassEventRecord[]> {
  let whereClause = '';
  const params: unknown[] = [];

  if (input.role === 'system_admin') {
    whereClause = '';
  } else if (input.role === 'org_admin') {
    if (!input.organizationId) return [];
    params.push(input.organizationId);
    whereClause = 'WHERE organization_id = $1';
  } else if (input.role === 'teacher') {
    params.push(input.userId);
    whereClause = 'WHERE owner_user_id = $1';
  } else {
    return [];
  }

  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `SELECT ${SCHEDULED_CLASS_COLUMNS}
     FROM scheduled_class_events
     ${whereClause}
     ORDER BY starts_at ASC, title ASC`,
    params,
  );

  return rows?.map(mapScheduledClassEventRow) ?? [];
}

export async function readScheduledClassEventRecord(
  id: string,
): Promise<ScheduledClassEventRecord | null> {
  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `SELECT ${SCHEDULED_CLASS_COLUMNS}
     FROM scheduled_class_events
     WHERE id = $1
     LIMIT 1`,
    [id],
  );

  if (!rows) return null;
  return rows[0] ? mapScheduledClassEventRow(rows[0]) : null;
}

export async function upsertScheduledClassEventRecord(
  event: ScheduledClassEventRecord,
): Promise<ScheduledClassEventRecord | null> {
  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `INSERT INTO scheduled_class_events (
        id,
        owner_user_id,
        organization_id,
        title,
        starts_at,
        duration_minutes,
        classroom_id,
        multiplayer_game,
        discord_sync,
        created_at,
        updated_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        starts_at = EXCLUDED.starts_at,
        duration_minutes = EXCLUDED.duration_minutes,
        classroom_id = EXCLUDED.classroom_id,
        multiplayer_game = EXCLUDED.multiplayer_game,
        discord_sync = EXCLUDED.discord_sync,
        updated_at = EXCLUDED.updated_at
      RETURNING ${SCHEDULED_CLASS_COLUMNS}`,
    [
      event.id,
      event.ownerUserId,
      event.organizationId,
      event.title,
      event.startsAt,
      event.durationMinutes ?? null,
      event.classroomId ?? null,
      event.multiplayerGame ?? null,
      event.discordSync ?? null,
      event.createdAt,
      event.updatedAt,
    ],
  );

  if (!rows) return null;
  return rows[0] ? mapScheduledClassEventRow(rows[0]) : null;
}

export async function deleteScheduledClassEventRecord(id: string): Promise<boolean> {
  const rows = await runPostgresQuery<{ id: string }>(
    `DELETE FROM scheduled_class_events
     WHERE id = $1
     RETURNING id`,
    [id],
  );

  return Boolean(rows?.[0]);
}

export async function listDiscordSyncedScheduledClassEventRecords(): Promise<
  ScheduledClassEventRecord[]
> {
  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `SELECT ${SCHEDULED_CLASS_COLUMNS}
     FROM scheduled_class_events
     WHERE discord_sync IS NOT NULL
       AND discord_sync->>'enabled' = 'true'
     ORDER BY starts_at ASC, title ASC`,
  );

  return rows?.map(mapScheduledClassEventRow) ?? [];
}

export async function claimDiscordScheduledClassReminderRecord(input: {
  id: string;
  claimedAt: string;
  latestReminderAt: string;
  now: string;
  staleClaimBefore: string;
}): Promise<ScheduledClassEventRecord | null> {
  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `UPDATE scheduled_class_events
     SET discord_sync = jsonb_set(
           discord_sync - 'syncWarning' - 'reminderMessageId',
           '{reminderClaimedAt}',
           to_jsonb($2::text),
           true
         ),
         updated_at = $2
     WHERE id = $1
       AND starts_at >= $4
       AND starts_at <= $5
       AND discord_sync IS NOT NULL
       AND discord_sync->>'enabled' = 'true'
       AND NULLIF(discord_sync->>'channelId', '') IS NOT NULL
       AND NULLIF(discord_sync->>'inviteUrl', '') IS NOT NULL
       AND (discord_sync->>'reminderSentAt') IS NULL
       AND (
         (discord_sync->>'reminderClaimedAt') IS NULL
         OR (discord_sync->>'reminderClaimedAt') <= $3
       )
     RETURNING ${SCHEDULED_CLASS_COLUMNS}`,
    [input.id, input.claimedAt, input.staleClaimBefore, input.now, input.latestReminderAt],
  );

  if (!rows) return null;
  return rows[0] ? mapScheduledClassEventRow(rows[0]) : null;
}

export async function finalizeDiscordScheduledClassReminderRecord(input: {
  id: string;
  claimedAt: string;
  messageId: string;
  sentAt: string;
}): Promise<ScheduledClassEventRecord | null> {
  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `UPDATE scheduled_class_events
     SET discord_sync = jsonb_set(
           jsonb_set(
             discord_sync - 'reminderClaimedAt' - 'syncWarning',
             '{reminderSentAt}',
             to_jsonb($3::text),
             true
           ),
           '{reminderMessageId}',
           to_jsonb($4::text),
           true
         ),
         updated_at = $3
     WHERE id = $1
       AND discord_sync->>'reminderClaimedAt' = $2
       AND (discord_sync->>'reminderSentAt') IS NULL
     RETURNING ${SCHEDULED_CLASS_COLUMNS}`,
    [input.id, input.claimedAt, input.sentAt, input.messageId],
  );

  if (!rows) return null;
  return rows[0] ? mapScheduledClassEventRow(rows[0]) : null;
}

export async function releaseDiscordScheduledClassReminderClaimRecord(input: {
  id: string;
  claimedAt: string;
  releasedAt: string;
  syncWarning: string;
}): Promise<ScheduledClassEventRecord | null> {
  const rows = await runPostgresQuery<ScheduledClassEventRow>(
    `UPDATE scheduled_class_events
     SET discord_sync = jsonb_set(
           discord_sync - 'reminderClaimedAt' - 'reminderMessageId' - 'reminderSentAt',
           '{syncWarning}',
           to_jsonb($3::text),
           true
         ),
         updated_at = $4
     WHERE id = $1
       AND discord_sync->>'reminderClaimedAt' = $2
       AND (discord_sync->>'reminderSentAt') IS NULL
     RETURNING ${SCHEDULED_CLASS_COLUMNS}`,
    [input.id, input.claimedAt, input.syncWarning, input.releasedAt],
  );

  if (!rows) return null;
  return rows[0] ? mapScheduledClassEventRow(rows[0]) : null;
}
