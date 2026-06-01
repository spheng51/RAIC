import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DiscordConnectionRecord, PlatformStore } from '@/lib/db/schema';

type DiscordConnectionRow = {
  id: string;
  owner_user_id: string;
  organization_id: string | null;
  guild_id: string;
  guild_name: string;
  channel_id: string | null;
  channel_name: string | null;
  created_at: string;
  updated_at: string;
};

function createStore(): PlatformStore {
  return {
    users: [],
    organizations: [],
    memberships: [],
    sessions: [],
    joinTokens: [],
    auditLogs: [],
    organizationAiPolicies: [],
    organizationProviderConfigs: [],
    userProviderOverrides: [],
    classroomSessionContexts: [],
    classroomReflections: [],
    benchmarkArtifacts: [],
    scheduledClassEvents: [],
    discordConnections: [],
  };
}

function rowFromParams(params: unknown[]): DiscordConnectionRow {
  return {
    id: params[0] as string,
    owner_user_id: params[1] as string,
    organization_id: (params[2] as string | null) ?? null,
    guild_id: params[3] as string,
    guild_name: params[4] as string,
    channel_id: (params[5] as string | null) ?? null,
    channel_name: (params[6] as string | null) ?? null,
    created_at: params[7] as string,
    updated_at: params[8] as string,
  };
}

function connectionMatchesOrganization(
  row: DiscordConnectionRow,
  organizationId: unknown,
): boolean {
  return row.organization_id === ((organizationId as string | null) ?? null);
}

async function importJsonRepository(store: PlatformStore) {
  vi.doMock('@/lib/db/client', () => ({
    isPostgresConfigured: () => false,
    readPlatformStore: vi.fn(async () => store),
    runPostgresQuery: vi.fn(async () => null),
    updatePlatformStore: vi.fn(async (updater) => updater(store)),
  }));

  return import('@/lib/db/repositories/discord-connections');
}

async function importPostgresRepository() {
  const rows: DiscordConnectionRow[] = [];
  const runPostgresQuery = vi.fn(async (query: string, params: unknown[] = []) => {
    const normalizedQuery = query.replace(/\s+/g, ' ').trim();

    if (
      normalizedQuery.startsWith('SELECT') &&
      normalizedQuery.includes('AND (id = $3 OR guild_id = $4)')
    ) {
      return rows
        .filter(
          (row) =>
            row.owner_user_id === params[0] &&
            connectionMatchesOrganization(row, params[1]) &&
            (row.id === params[2] || row.guild_id === params[3]),
        )
        .sort((left, right) => {
          if (left.id === params[2]) return -1;
          if (right.id === params[2]) return 1;
          return left.created_at.localeCompare(right.created_at);
        })
        .slice(0, 1);
    }

    if (
      normalizedQuery.startsWith('SELECT') &&
      normalizedQuery.includes('WHERE owner_user_id = $1 ORDER BY guild_name')
    ) {
      return rows
        .filter((row) => row.owner_user_id === params[0])
        .sort(
          (left, right) =>
            left.guild_name.localeCompare(right.guild_name) ||
            left.created_at.localeCompare(right.created_at),
        );
    }

    if (normalizedQuery.startsWith('UPDATE discord_connections')) {
      const index = rows.findIndex(
        (row) => row.id === params[0] && row.owner_user_id === params[1],
      );
      if (index === -1) return [];
      rows[index] = {
        ...rows[index],
        organization_id: (params[2] as string | null) ?? null,
        guild_id: params[3] as string,
        guild_name: params[4] as string,
        channel_id: (params[5] as string | null) ?? null,
        channel_name: (params[6] as string | null) ?? null,
        updated_at: params[7] as string,
      };
      return [rows[index]];
    }

    if (normalizedQuery.startsWith('INSERT INTO discord_connections')) {
      const next = rowFromParams(params);
      if (
        rows.some(
          (row) =>
            row.owner_user_id === next.owner_user_id &&
            row.organization_id === next.organization_id &&
            row.guild_id === next.guild_id,
        )
      ) {
        throw new Error('duplicate discord connection');
      }
      rows.push(next);
      return [next];
    }

    return [];
  });

  vi.doMock('@/lib/db/client', () => ({
    isPostgresConfigured: () => true,
    readPlatformStore: vi.fn(),
    runPostgresQuery,
    updatePlatformStore: vi.fn(),
  }));

  const repository = await import('@/lib/db/repositories/discord-connections');
  return { repository, rows, runPostgresQuery };
}

describe('Discord connection repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('keeps same-guild JSON connections separate across organizations', async () => {
    const store = createStore();
    const repository = await importJsonRepository(store);

    const orgOne = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-1',
      channelName: 'announcements',
    });
    const orgTwo = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-2',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-2',
      channelName: 'study-hall',
    });
    const updatedOrgOne = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-3',
      channelName: 'lab',
    });

    expect(orgOne.id).not.toBe(orgTwo.id);
    expect(updatedOrgOne.id).toBe(orgOne.id);
    expect(store.discordConnections).toHaveLength(2);
    expect(store.discordConnections).toEqual(
      expect.arrayContaining<DiscordConnectionRecord>([
        expect.objectContaining({
          id: orgOne.id,
          organizationId: 'org-1',
          guildId: 'guild-1',
          channelId: 'channel-3',
        }),
        expect.objectContaining({
          id: orgTwo.id,
          organizationId: 'org-2',
          guildId: 'guild-1',
          channelId: 'channel-2',
        }),
      ]),
    );
  });

  it('keeps same-guild Postgres connections separate across organizations', async () => {
    const { repository, rows, runPostgresQuery } = await importPostgresRepository();

    const orgOne = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-1',
      channelName: 'announcements',
    });
    const orgTwo = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-2',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-2',
      channelName: 'study-hall',
    });
    const updatedOrgOne = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-3',
      channelName: 'lab',
    });

    expect(orgOne.id).not.toBe(orgTwo.id);
    expect(updatedOrgOne.id).toBe(orgOne.id);
    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining<DiscordConnectionRow>([
        expect.objectContaining({
          id: orgOne.id,
          organization_id: 'org-1',
          guild_id: 'guild-1',
          channel_id: 'channel-3',
        }),
        expect.objectContaining({
          id: orgTwo.id,
          organization_id: 'org-2',
          guild_id: 'guild-1',
          channel_id: 'channel-2',
        }),
      ]),
    );
    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining('organization_id IS NOT DISTINCT FROM $2'),
      expect.arrayContaining(['org-1', 'guild-1']),
    );
  });

  it('handles a stale Postgres upsert read with the scoped unique index', async () => {
    const rows: DiscordConnectionRow[] = [
      {
        id: 'connection-existing',
        owner_user_id: 'teacher-1',
        organization_id: 'org-1',
        guild_id: 'guild-1',
        guild_name: 'Shared Guild',
        channel_id: 'channel-1',
        channel_name: 'announcements',
        created_at: '2026-05-11T00:00:00.000Z',
        updated_at: '2026-05-11T00:00:00.000Z',
      },
    ];
    const runPostgresQuery = vi.fn(async (query: string, params: unknown[] = []) => {
      const normalizedQuery = query.replace(/\s+/g, ' ').trim();

      if (normalizedQuery.startsWith('SELECT')) {
        return [];
      }

      if (normalizedQuery.startsWith('INSERT INTO discord_connections')) {
        const next = rowFromParams(params);
        const existingIndex = rows.findIndex(
          (row) =>
            row.owner_user_id === next.owner_user_id &&
            row.organization_id === next.organization_id &&
            row.guild_id === next.guild_id,
        );
        if (existingIndex >= 0) {
          rows[existingIndex] = {
            ...rows[existingIndex],
            guild_name: next.guild_name,
            channel_id: next.channel_id,
            channel_name: next.channel_name,
            updated_at: next.updated_at,
          };
          return [rows[existingIndex]];
        }
        rows.push(next);
        return [next];
      }

      return [];
    });

    vi.doMock('@/lib/db/client', () => ({
      isPostgresConfigured: () => true,
      readPlatformStore: vi.fn(),
      runPostgresQuery,
      updatePlatformStore: vi.fn(),
    }));

    const repository = await import('@/lib/db/repositories/discord-connections');

    const updated = await repository.upsertDiscordConnection({
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Shared Guild',
      channelId: 'channel-2',
      channelName: 'study-hall',
    });

    expect(updated.id).toBe('connection-existing');
    expect(updated.channelId).toBe('channel-2');
    expect(rows).toHaveLength(1);
    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining(
        "ON CONFLICT (owner_user_id, COALESCE(organization_id, ''), guild_id)",
      ),
      expect.any(Array),
    );
  });
});
