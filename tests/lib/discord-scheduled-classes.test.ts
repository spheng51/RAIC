import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ScheduledClassEventRecord } from '@/lib/db/schema';

function makeEvent(overrides: Partial<ScheduledClassEventRecord> = {}): ScheduledClassEventRecord {
  return {
    id: 'class-1',
    ownerUserId: 'teacher-1',
    organizationId: 'org-1',
    title: 'Physics game night',
    startsAt: '2026-05-12T17:00:00.000Z',
    durationMinutes: 45,
    classroomId: 'room-1',
    createdAt: '2026-05-11T00:00:00.000Z',
    updatedAt: '2026-05-11T00:00:00.000Z',
    ...overrides,
  };
}

describe('Discord scheduled class helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it('maps RAIC scheduled classes to external Discord event payloads', async () => {
    const { buildDiscordScheduledClassPayload } = await import('@/lib/server/scheduled-classes');

    const payload = buildDiscordScheduledClassPayload({
      event: makeEvent({
        multiplayerGame: {
          enabled: true,
          mode: 'both',
          linkPolicy: 'always_open',
        },
      }),
      inviteUrl: 'https://open-raic.com/join/token',
      classroomName: 'Physics Arcade',
    });

    expect(payload).toMatchObject({
      name: 'Physics game night',
      scheduled_start_time: '2026-05-12T17:00:00.000Z',
      scheduled_end_time: '2026-05-12T17:45:00.000Z',
      privacy_level: 2,
      entity_type: 3,
      entity_metadata: { location: 'Open RAIC classroom' },
    });
    expect(payload.description).toContain('https://open-raic.com/join/token');
    expect(payload.description).toContain('Multiplayer Game Mode');
  });

  it('normalizes Discord API errors for stored sync warnings', async () => {
    const { DiscordApiError, normalizeDiscordError } = await import('@/lib/server/discord');

    expect(normalizeDiscordError(new DiscordApiError('Nope', 403, 'Missing Permissions'))).toBe(
      'Discord request failed (403). Missing Permissions',
    );
    expect(normalizeDiscordError(new Error('plain failure'))).toBe('plain failure');
  });

  it('sends one reminder per due class and skips already-reminded classes', async () => {
    const sendDiscordChannelMessage = vi.fn().mockResolvedValue({ id: 'message-1' });
    const store = {
      scheduledClassEvents: [
        makeEvent({
          id: 'due',
          discordSync: {
            enabled: true,
            channelId: 'channel-1',
            inviteUrl: 'https://open-raic.com/join/due',
          },
        }),
        makeEvent({
          id: 'already-sent',
          discordSync: {
            enabled: true,
            channelId: 'channel-1',
            inviteUrl: 'https://open-raic.com/join/sent',
            reminderSentAt: '2026-05-12T16:50:00.000Z',
          },
        }),
      ],
      discordConnections: [],
    };

    vi.doMock('@/lib/db/client', () => ({
      isPostgresConfigured: () => false,
      readPlatformStore: vi.fn().mockResolvedValue(store),
      updatePlatformStore: vi.fn(async (updater) => updater(store)),
    }));
    vi.doMock('@/lib/db/repositories/join-tokens', () => ({
      createJoinTokenRecord: vi.fn(),
      updateJoinTokenExpiration: vi.fn(),
    }));
    vi.doMock('@/lib/db/repositories/discord-connections', () => ({
      listDiscordConnectionsForUser: vi.fn(),
      readDiscordConnectionForUser: vi.fn(),
    }));
    vi.doMock('@/lib/db/repositories/scheduled-classes', () => ({
      deleteScheduledClassEventRecord: vi.fn(),
      listDiscordSyncedScheduledClassEventRecords: vi.fn(),
      listScheduledClassEventRecordsForAccess: vi.fn(),
      readScheduledClassEventRecord: vi.fn(),
      upsertScheduledClassEventRecord: vi.fn(),
    }));
    vi.doMock('@/lib/server/classroom-storage', () => ({
      readClassroom: vi.fn().mockResolvedValue({ stage: { name: 'Physics Arcade' } }),
    }));
    vi.doMock('@/lib/server/discord', () => ({
      DiscordApiError: class DiscordApiError extends Error {
        status = 500;
      },
      createDiscordScheduledEvent: vi.fn(),
      deleteDiscordScheduledEvent: vi.fn(),
      normalizeDiscordError: (error: unknown) =>
        error instanceof Error ? error.message : String(error),
      sendDiscordChannelMessage,
      updateDiscordScheduledEvent: vi.fn(),
    }));

    const { sendDueDiscordScheduledClassReminders } =
      await import('@/lib/server/scheduled-classes');
    const result = await sendDueDiscordScheduledClassReminders({
      now: new Date('2026-05-12T16:50:00.000Z'),
    });

    expect(result).toEqual({ checked: 1, sent: 1, failed: 0 });
    expect(sendDiscordChannelMessage).toHaveBeenCalledTimes(1);
    expect(store.scheduledClassEvents[0].discordSync?.reminderMessageId).toBe('message-1');
  });
});
