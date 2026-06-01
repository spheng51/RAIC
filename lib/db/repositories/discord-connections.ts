import 'server-only';

import { randomUUID } from 'crypto';
import {
  isPostgresConfigured,
  readPlatformStore,
  runPostgresQuery,
  updatePlatformStore,
} from '@/lib/db/client';
import type { DiscordConnectionRecord } from '@/lib/db/schema';

export type DiscordConnectionInput = Omit<
  DiscordConnectionRecord,
  'id' | 'createdAt' | 'updatedAt'
> & {
  id?: string;
};

interface DiscordConnectionRow {
  id: string;
  owner_user_id: string;
  organization_id: string | null;
  guild_id: string;
  guild_name: string;
  channel_id: string | null;
  channel_name: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const DISCORD_CONNECTION_COLUMNS = `
  id,
  owner_user_id,
  organization_id,
  guild_id,
  guild_name,
  channel_id,
  channel_name,
  created_at,
  updated_at
`;

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function mapDiscordConnectionRow(row: DiscordConnectionRow): DiscordConnectionRecord {
  return {
    id: row.id,
    ownerUserId: row.owner_user_id,
    organizationId: row.organization_id,
    guildId: row.guild_id,
    guildName: row.guild_name,
    channelId: row.channel_id,
    channelName: row.channel_name,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

async function readDiscordConnectionForUpsert(
  input: DiscordConnectionInput,
): Promise<DiscordConnectionRecord | null> {
  const rows = await runPostgresQuery<DiscordConnectionRow>(
    `SELECT ${DISCORD_CONNECTION_COLUMNS}
     FROM discord_connections
     WHERE owner_user_id = $1
       AND organization_id IS NOT DISTINCT FROM $2
       AND (id = $3 OR guild_id = $4)
     ORDER BY CASE WHEN id = $3 THEN 0 ELSE 1 END, created_at ASC
     LIMIT 1`,
    [input.ownerUserId, input.organizationId, input.id ?? '', input.guildId],
  );
  return rows?.[0] ? mapDiscordConnectionRow(rows[0]) : null;
}

export async function listDiscordConnectionsForUser(
  ownerUserId: string,
): Promise<DiscordConnectionRecord[]> {
  if (isPostgresConfigured()) {
    const rows = await runPostgresQuery<DiscordConnectionRow>(
      `SELECT ${DISCORD_CONNECTION_COLUMNS}
       FROM discord_connections
       WHERE owner_user_id = $1
       ORDER BY guild_name ASC, created_at ASC`,
      [ownerUserId],
    );
    return rows?.map(mapDiscordConnectionRow) ?? [];
  }

  const store = await readPlatformStore();
  return store.discordConnections
    .filter((connection) => connection.ownerUserId === ownerUserId)
    .sort(
      (a, b) => a.guildName.localeCompare(b.guildName) || a.createdAt.localeCompare(b.createdAt),
    );
}

export async function readDiscordConnectionForUser(
  ownerUserId: string,
  id: string,
): Promise<DiscordConnectionRecord | null> {
  if (isPostgresConfigured()) {
    const rows = await runPostgresQuery<DiscordConnectionRow>(
      `SELECT ${DISCORD_CONNECTION_COLUMNS}
       FROM discord_connections
       WHERE owner_user_id = $1 AND id = $2
       LIMIT 1`,
      [ownerUserId, id],
    );
    return rows?.[0] ? mapDiscordConnectionRow(rows[0]) : null;
  }

  const store = await readPlatformStore();
  return (
    store.discordConnections.find(
      (connection) => connection.ownerUserId === ownerUserId && connection.id === id,
    ) ?? null
  );
}

export async function upsertDiscordConnection(
  input: DiscordConnectionInput,
): Promise<DiscordConnectionRecord> {
  const timestamp = new Date().toISOString();

  if (isPostgresConfigured()) {
    const existing = await readDiscordConnectionForUpsert(input);
    const id = existing?.id ?? input.id ?? randomUUID();
    const createdAt = existing?.createdAt ?? timestamp;

    if (existing) {
      const rows = await runPostgresQuery<DiscordConnectionRow>(
        `UPDATE discord_connections
         SET organization_id = $3,
             guild_id = $4,
             guild_name = $5,
             channel_id = $6,
             channel_name = $7,
             updated_at = $8
         WHERE id = $1 AND owner_user_id = $2
         RETURNING ${DISCORD_CONNECTION_COLUMNS}`,
        [
          id,
          input.ownerUserId,
          input.organizationId,
          input.guildId,
          input.guildName,
          input.channelId,
          input.channelName,
          timestamp,
        ],
      );
      if (!rows?.[0]) {
        throw new Error('Failed to save Discord connection.');
      }
      return mapDiscordConnectionRow(rows[0]);
    }

    const rows = await runPostgresQuery<DiscordConnectionRow>(
      `INSERT INTO discord_connections (
          id,
          owner_user_id,
          organization_id,
          guild_id,
          guild_name,
          channel_id,
          channel_name,
          created_at,
          updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (owner_user_id, COALESCE(organization_id, ''), guild_id) DO UPDATE SET
          guild_name = EXCLUDED.guild_name,
          channel_id = EXCLUDED.channel_id,
          channel_name = EXCLUDED.channel_name,
          updated_at = EXCLUDED.updated_at
        RETURNING ${DISCORD_CONNECTION_COLUMNS}`,
      [
        id,
        input.ownerUserId,
        input.organizationId,
        input.guildId,
        input.guildName,
        input.channelId,
        input.channelName,
        createdAt,
        timestamp,
      ],
    );
    if (!rows?.[0]) {
      throw new Error('Failed to save Discord connection.');
    }
    return mapDiscordConnectionRow(rows[0]);
  }

  return updatePlatformStore((store) => {
    const existingIndex = store.discordConnections.findIndex(
      (connection) =>
        connection.ownerUserId === input.ownerUserId &&
        connection.organizationId === input.organizationId &&
        (connection.id === input.id || connection.guildId === input.guildId),
    );
    const existing = existingIndex >= 0 ? store.discordConnections[existingIndex] : null;
    const record: DiscordConnectionRecord = {
      id: existing?.id ?? input.id ?? randomUUID(),
      ownerUserId: input.ownerUserId,
      organizationId: input.organizationId,
      guildId: input.guildId,
      guildName: input.guildName,
      channelId: input.channelId,
      channelName: input.channelName,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    if (existingIndex >= 0) {
      store.discordConnections[existingIndex] = record;
    } else {
      store.discordConnections.push(record);
    }
    return record;
  });
}

export async function deleteDiscordConnectionForUser(
  ownerUserId: string,
  id: string,
): Promise<boolean> {
  if (isPostgresConfigured()) {
    const rows = await runPostgresQuery<{ id: string }>(
      `DELETE FROM discord_connections
       WHERE owner_user_id = $1 AND id = $2
       RETURNING id`,
      [ownerUserId, id],
    );
    return Boolean(rows?.[0]);
  }

  return updatePlatformStore((store) => {
    const index = store.discordConnections.findIndex(
      (connection) => connection.ownerUserId === ownerUserId && connection.id === id,
    );
    if (index < 0) return false;
    store.discordConnections.splice(index, 1);
    return true;
  });
}
