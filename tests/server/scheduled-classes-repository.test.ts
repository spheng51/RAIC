import { beforeEach, describe, expect, it, vi } from 'vitest';

type ScheduledClassEventRow = {
  id: string;
  owner_user_id: string | null;
  organization_id: string | null;
  title: string;
  starts_at: string;
  duration_minutes: number | null;
  classroom_id: string | null;
  multiplayer_game: null;
  discord_sync: {
    enabled: boolean;
    channelId?: string;
    inviteUrl?: string;
    reminderClaimedAt?: string;
    reminderMessageId?: string;
    reminderSentAt?: string;
    syncWarning?: string;
  } | null;
  created_at: string;
  updated_at: string;
};

function makeRow(overrides: Partial<ScheduledClassEventRow> = {}): ScheduledClassEventRow {
  return {
    id: 'class-1',
    owner_user_id: 'teacher-1',
    organization_id: 'org-1',
    title: 'Physics game night',
    starts_at: '2026-05-12T17:00:00.000Z',
    duration_minutes: 45,
    classroom_id: 'room-1',
    multiplayer_game: null,
    discord_sync: {
      enabled: true,
      channelId: 'channel-1',
      inviteUrl: 'https://open-raic.com/join/token',
    },
    created_at: '2026-05-11T00:00:00.000Z',
    updated_at: '2026-05-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('scheduled class repository', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('claims Discord reminders with an atomic Postgres conditional update', async () => {
    const claimedAt = '2026-05-12T16:50:00.000Z';
    const runPostgresQuery = vi
      .fn()
      .mockResolvedValueOnce([
        makeRow({
          discord_sync: {
            enabled: true,
            channelId: 'channel-1',
            inviteUrl: 'https://open-raic.com/join/token',
            reminderClaimedAt: claimedAt,
          },
          updated_at: claimedAt,
        }),
      ])
      .mockResolvedValueOnce([]);

    vi.doMock('@/lib/db/client', () => ({
      runPostgresQuery,
    }));

    const { claimDiscordScheduledClassReminderRecord } =
      await import('@/lib/db/repositories/scheduled-classes');

    await expect(
      claimDiscordScheduledClassReminderRecord({
        id: 'class-1',
        claimedAt,
        now: claimedAt,
        latestReminderAt: '2026-05-12T17:00:00.000Z',
        staleClaimBefore: '2026-05-12T16:35:00.000Z',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        id: 'class-1',
        discordSync: expect.objectContaining({ reminderClaimedAt: claimedAt }),
      }),
    );

    await expect(
      claimDiscordScheduledClassReminderRecord({
        id: 'class-1',
        claimedAt,
        now: claimedAt,
        latestReminderAt: '2026-05-12T17:00:00.000Z',
        staleClaimBefore: '2026-05-12T16:35:00.000Z',
      }),
    ).resolves.toBeNull();

    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("AND (discord_sync->>'reminderSentAt') IS NULL"),
      ['class-1', claimedAt, '2026-05-12T16:35:00.000Z', claimedAt, '2026-05-12T17:00:00.000Z'],
    );
    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("NULLIF(discord_sync->>'channelId', '') IS NOT NULL"),
      expect.any(Array),
    );
    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining('starts_at <= $5'),
      expect.any(Array),
    );
  });

  it('finalizes Discord reminders with a claim-matching Postgres update', async () => {
    const claimedAt = '2026-05-12T16:50:00.000Z';
    const sentAt = '2026-05-12T16:51:00.000Z';
    const runPostgresQuery = vi.fn().mockResolvedValueOnce([
      makeRow({
        discord_sync: {
          enabled: true,
          channelId: 'channel-1',
          inviteUrl: 'https://open-raic.com/join/token',
          reminderSentAt: sentAt,
          reminderMessageId: 'message-1',
        },
        updated_at: sentAt,
      }),
    ]);

    vi.doMock('@/lib/db/client', () => ({
      runPostgresQuery,
    }));

    const { finalizeDiscordScheduledClassReminderRecord } =
      await import('@/lib/db/repositories/scheduled-classes');

    await expect(
      finalizeDiscordScheduledClassReminderRecord({
        id: 'class-1',
        claimedAt,
        messageId: 'message-1',
        sentAt,
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        discordSync: expect.objectContaining({
          reminderSentAt: sentAt,
          reminderMessageId: 'message-1',
        }),
      }),
    );

    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("discord_sync->>'reminderClaimedAt' = $2"),
      ['class-1', claimedAt, sentAt, 'message-1'],
    );
    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("discord_sync - 'reminderClaimedAt' - 'syncWarning'"),
      expect.any(Array),
    );
  });

  it('releases Discord reminder claims with a claim-matching Postgres update', async () => {
    const claimedAt = '2026-05-12T16:50:00.000Z';
    const releasedAt = '2026-05-12T16:51:00.000Z';
    const runPostgresQuery = vi.fn().mockResolvedValueOnce([
      makeRow({
        discord_sync: {
          enabled: true,
          channelId: 'channel-1',
          inviteUrl: 'https://open-raic.com/join/token',
          syncWarning: 'Discord unavailable',
        },
        updated_at: releasedAt,
      }),
    ]);

    vi.doMock('@/lib/db/client', () => ({
      runPostgresQuery,
    }));

    const { releaseDiscordScheduledClassReminderClaimRecord } =
      await import('@/lib/db/repositories/scheduled-classes');

    await expect(
      releaseDiscordScheduledClassReminderClaimRecord({
        id: 'class-1',
        claimedAt,
        releasedAt,
        syncWarning: 'Discord unavailable',
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        discordSync: expect.objectContaining({
          syncWarning: 'Discord unavailable',
        }),
      }),
    );

    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("discord_sync - 'reminderClaimedAt' - 'reminderMessageId'"),
      ['class-1', claimedAt, 'Discord unavailable', releasedAt],
    );
    expect(runPostgresQuery).toHaveBeenCalledWith(
      expect.stringContaining("discord_sync->>'reminderClaimedAt' = $2"),
      expect.any(Array),
    );
  });
});
