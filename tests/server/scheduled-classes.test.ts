import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlatformStore } from '@/lib/db/schema';

const readPlatformStoreMock = vi.fn();
const updatePlatformStoreMock = vi.fn();
const runPostgresQueryMock = vi.fn();
const discordMocks = vi.hoisted(() => ({
  createDiscordScheduledEvent: vi.fn(),
  deleteDiscordScheduledEvent: vi.fn(),
  sendDiscordChannelMessage: vi.fn(),
  updateDiscordScheduledEvent: vi.fn(),
}));

vi.mock('@/lib/db/client', () => ({
  isPostgresConfigured: () => false,
  readPlatformStore: readPlatformStoreMock,
  runPostgresQuery: runPostgresQueryMock,
  updatePlatformStore: updatePlatformStoreMock,
}));

vi.mock('@/lib/db/repositories/scheduled-classes', () => ({
  deleteScheduledClassEventRecord: vi.fn(),
  listScheduledClassEventRecordsForAccess: vi.fn(),
  readScheduledClassEventRecord: vi.fn(),
  upsertScheduledClassEventRecord: vi.fn(),
}));

vi.mock('@/lib/server/discord', () => {
  class DiscordApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
      readonly responseText?: string,
    ) {
      super(message);
      this.name = 'DiscordApiError';
    }
  }

  return {
    createDiscordScheduledEvent: discordMocks.createDiscordScheduledEvent,
    deleteDiscordScheduledEvent: discordMocks.deleteDiscordScheduledEvent,
    DiscordApiError,
    normalizeDiscordError: (error: unknown) => {
      if (error instanceof DiscordApiError) {
        return `Discord request failed (${error.status}). ${error.responseText || error.message}`;
      }
      return error instanceof Error ? error.message : String(error);
    },
    sendDiscordChannelMessage: discordMocks.sendDiscordChannelMessage,
    updateDiscordScheduledEvent: discordMocks.updateDiscordScheduledEvent,
  };
});

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

describe('scheduled class server storage', () => {
  let store: PlatformStore;

  beforeEach(() => {
    vi.resetModules();
    store = createStore();
    readPlatformStoreMock.mockReset();
    updatePlatformStoreMock.mockReset();
    runPostgresQueryMock.mockReset();
    readPlatformStoreMock.mockImplementation(async () => store);
    updatePlatformStoreMock.mockImplementation(async (updater) => updater(store));
    runPostgresQueryMock.mockResolvedValue(null);
    Object.values(discordMocks).forEach((mock) => mock.mockReset());
  });

  it('persists scheduled classes and scopes access by teacher owner', async () => {
    const {
      createScheduledClassForAccess,
      deleteScheduledClassForAccess,
      listScheduledClassesForAccess,
      updateScheduledClassForAccess,
    } = await import('@/lib/server/scheduled-classes');

    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    const otherScope = {
      role: 'teacher' as const,
      userId: 'teacher-2',
      organizationId: 'org-1',
    };

    const created = await createScheduledClassForAccess(teacherScope, {
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      durationMinutes: 45,
    });
    await createScheduledClassForAccess(otherScope, {
      title: 'Other lab',
      startsAt: '2099-05-13T17:00:00.000Z',
    });

    await expect(listScheduledClassesForAccess(teacherScope)).resolves.toEqual([
      expect.objectContaining({ id: created.id, title: 'Physics lab' }),
    ]);
    await expect(
      updateScheduledClassForAccess(otherScope, created.id, {
        title: 'Hijacked',
        startsAt: '2099-05-14T17:00:00.000Z',
      }),
    ).resolves.toBeNull();

    await expect(
      updateScheduledClassForAccess(teacherScope, created.id, {
        title: 'Updated physics lab',
        startsAt: '2099-05-14T17:00:00.000Z',
      }),
    ).resolves.toEqual(expect.objectContaining({ title: 'Updated physics lab' }));
    await expect(deleteScheduledClassForAccess(otherScope, created.id)).resolves.toBe(false);
    await expect(deleteScheduledClassForAccess(teacherScope, created.id)).resolves.toBe(true);
  });

  it('clears Discord reminder state when a synced class is rescheduled', async () => {
    const { updateScheduledClassForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
      discordSync: {
        enabled: true,
        connectionId: 'connection-1',
        guildId: 'guild-1',
        guildName: 'Physics Guild',
        channelId: 'channel-1',
        channelName: 'announcements',
        inviteUrl: 'https://open-raic.com/join/token',
        scheduledEventId: 'discord-event-1',
        reminderSentAt: '2099-05-12T16:50:00.000Z',
        reminderMessageId: 'message-1',
      },
    });

    const updated = await updateScheduledClassForAccess(teacherScope, 'event-1', {
      title: 'Physics lab later',
      startsAt: '2099-05-13T17:00:00.000Z',
      classroomId: 'room-1',
    });

    expect(updated?.discordSync).toEqual(
      expect.objectContaining({
        enabled: true,
        connectionId: 'connection-1',
        scheduledEventId: 'discord-event-1',
      }),
    );
    expect(updated?.discordSync?.reminderSentAt).toBeUndefined();
    expect(updated?.discordSync?.reminderMessageId).toBeUndefined();
    expect(store.scheduledClassEvents[0].discordSync?.reminderSentAt).toBeUndefined();
    expect(store.scheduledClassEvents[0].discordSync?.reminderMessageId).toBeUndefined();
  });

  it('deletes synced Discord events before removing scheduled classes', async () => {
    const { deleteScheduledClassForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
      discordSync: {
        enabled: true,
        guildId: 'guild-1',
        scheduledEventId: 'discord-event-1',
      },
    });

    await expect(deleteScheduledClassForAccess(teacherScope, 'event-1')).resolves.toBe(true);

    expect(discordMocks.deleteDiscordScheduledEvent).toHaveBeenCalledWith(
      'guild-1',
      'discord-event-1',
    );
    expect(store.scheduledClassEvents).toHaveLength(0);
  });

  it('treats missing Discord scheduled events as already deleted', async () => {
    const { DiscordApiError } = await import('@/lib/server/discord');
    const { deleteScheduledClassForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
      discordSync: {
        enabled: true,
        guildId: 'guild-1',
        scheduledEventId: 'discord-event-1',
      },
    });
    discordMocks.deleteDiscordScheduledEvent.mockRejectedValue(
      new DiscordApiError('Discord request failed', 404, 'Unknown Scheduled Event'),
    );

    await expect(deleteScheduledClassForAccess(teacherScope, 'event-1')).resolves.toBe(true);

    expect(store.scheduledClassEvents).toHaveLength(0);
  });

  it('preserves scheduled classes when Discord event deletion fails', async () => {
    const { DiscordApiError } = await import('@/lib/server/discord');
    const { deleteScheduledClassForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
      discordSync: {
        enabled: true,
        guildId: 'guild-1',
        scheduledEventId: 'discord-event-1',
      },
    });
    discordMocks.deleteDiscordScheduledEvent.mockRejectedValue(
      new DiscordApiError('Discord request failed', 500, 'Discord unavailable'),
    );

    await expect(deleteScheduledClassForAccess(teacherScope, 'event-1')).rejects.toThrow(
      'Failed to delete Discord scheduled event.',
    );

    expect(store.scheduledClassEvents).toHaveLength(1);
  });

  it('does not silently move legacy synced Discord classes to another connection', async () => {
    const { syncScheduledClassDiscordForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.discordConnections.push({
      id: 'connection-2',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-2',
      guildName: 'Other guild',
      channelId: 'channel-2',
      channelName: 'other-announcements',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
      discordSync: {
        enabled: true,
        guildId: 'guild-1',
        scheduledEventId: 'discord-event-1',
      },
    });

    await expect(
      syncScheduledClassDiscordForAccess(teacherScope, 'event-1', {
        baseUrl: 'https://open-raic.com',
      }),
    ).rejects.toThrow('Reconnect Discord before syncing this scheduled class.');

    expect(discordMocks.updateDiscordScheduledEvent).not.toHaveBeenCalled();
    expect(discordMocks.createDiscordScheduledEvent).not.toHaveBeenCalled();
  });

  it('uses an organization-matching Discord connection when selecting a default sync target', async () => {
    const { syncScheduledClassDiscordForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.discordConnections.push(
      {
        id: 'connection-other',
        ownerUserId: 'teacher-1',
        organizationId: 'org-2',
        guildId: 'guild-other',
        guildName: 'Alpha other guild',
        channelId: 'channel-other',
        channelName: 'other-announcements',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: 'connection-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        guildId: 'guild-1',
        guildName: 'Physics guild',
        channelId: 'channel-1',
        channelName: 'announcements',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
    );
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    discordMocks.createDiscordScheduledEvent.mockResolvedValue({
      id: 'discord-event-1',
      url: 'https://discord.com/events/guild-1/discord-event-1',
    });

    const result = await syncScheduledClassDiscordForAccess(teacherScope, 'event-1', {
      baseUrl: 'https://open-raic.com',
    });

    expect(discordMocks.createDiscordScheduledEvent).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({ name: 'Physics lab' }),
    );
    expect(discordMocks.createDiscordScheduledEvent).not.toHaveBeenCalledWith(
      'guild-other',
      expect.anything(),
    );
    expect(result?.discordSync).toEqual(
      expect.objectContaining({
        connectionId: 'connection-1',
        guildId: 'guild-1',
        channelId: 'channel-1',
      }),
    );
  });

  it('does not default Discord sync to a connection from another organization', async () => {
    const { syncScheduledClassDiscordForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.discordConnections.push({
      id: 'connection-other',
      ownerUserId: 'teacher-1',
      organizationId: 'org-2',
      guildId: 'guild-other',
      guildName: 'Other guild',
      channelId: 'channel-other',
      channelName: 'other-announcements',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });

    await expect(
      syncScheduledClassDiscordForAccess(teacherScope, 'event-1', {
        baseUrl: 'https://open-raic.com',
      }),
    ).rejects.toThrow('Connect Discord for this organization before syncing this scheduled class.');

    expect(discordMocks.createDiscordScheduledEvent).not.toHaveBeenCalled();
    expect(discordMocks.updateDiscordScheduledEvent).not.toHaveBeenCalled();
    expect(store.scheduledClassEvents[0].discordSync).toBeUndefined();
  });

  it('does not bind legacy unscoped scheduled classes to the active organization during sync', async () => {
    const { syncScheduledClassDiscordForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.discordConnections.push(
      {
        id: 'connection-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        guildId: 'guild-1',
        guildName: 'Physics guild',
        channelId: 'channel-1',
        channelName: 'announcements',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
      {
        id: 'connection-2',
        ownerUserId: 'teacher-1',
        organizationId: 'org-2',
        guildId: 'guild-2',
        guildName: 'Chemistry guild',
        channelId: 'channel-2',
        channelName: 'announcements',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
    );
    store.scheduledClassEvents.push({
      id: 'legacy-event',
      ownerUserId: 'teacher-1',
      organizationId: null,
      title: 'Legacy lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });

    await expect(
      syncScheduledClassDiscordForAccess(teacherScope, 'legacy-event', {
        baseUrl: 'https://open-raic.com',
      }),
    ).rejects.toThrow(
      'Assign this scheduled class to an organization before syncing with Discord.',
    );

    expect(discordMocks.createDiscordScheduledEvent).not.toHaveBeenCalled();
    expect(discordMocks.updateDiscordScheduledEvent).not.toHaveBeenCalled();
    expect(store.scheduledClassEvents[0].discordSync).toBeUndefined();
    expect(store.joinTokens).toHaveLength(0);
  });

  it('recreates missing upstream Discord scheduled events during resync', async () => {
    const { DiscordApiError } = await import('@/lib/server/discord');
    const { syncScheduledClassDiscordForAccess } = await import('@/lib/server/scheduled-classes');
    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };
    store.discordConnections.push({
      id: 'connection-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Physics guild',
      channelId: 'channel-1',
      channelName: 'announcements',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    store.scheduledClassEvents.push({
      id: 'event-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      title: 'Physics lab',
      startsAt: '2099-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
      discordSync: {
        enabled: true,
        connectionId: 'connection-1',
        guildId: 'guild-1',
        guildName: 'Physics guild',
        channelId: 'channel-1',
        channelName: 'announcements',
        scheduledEventId: 'discord-event-old',
        scheduledEventUrl: 'https://discord.com/events/guild-1/discord-event-old',
        lastSyncedAt: '2026-05-11T00:00:00.000Z',
      },
    });
    discordMocks.updateDiscordScheduledEvent.mockRejectedValue(
      new DiscordApiError('Discord request failed', 404, 'Unknown Scheduled Event'),
    );
    discordMocks.createDiscordScheduledEvent.mockResolvedValue({
      id: 'discord-event-new',
      url: 'https://discord.com/events/guild-1/discord-event-new',
    });

    const result = await syncScheduledClassDiscordForAccess(teacherScope, 'event-1', {
      baseUrl: 'https://open-raic.com',
    });

    expect(discordMocks.updateDiscordScheduledEvent).toHaveBeenCalledWith(
      'guild-1',
      'discord-event-old',
      expect.objectContaining({ name: 'Physics lab' }),
    );
    expect(discordMocks.createDiscordScheduledEvent).toHaveBeenCalledWith(
      'guild-1',
      expect.objectContaining({ name: 'Physics lab' }),
    );
    expect(result?.discordSync).toEqual(
      expect.objectContaining({
        scheduledEventId: 'discord-event-new',
        scheduledEventUrl: 'https://discord.com/events/guild-1/discord-event-new',
      }),
    );
    expect(result?.discordSync?.syncWarning).toBeUndefined();
    expect(store.scheduledClassEvents[0].discordSync?.scheduledEventId).toBe('discord-event-new');
  });

  it('creates multiplayer invites and refreshes expiry when scheduled classes change', async () => {
    const { createScheduledClassForAccess, updateScheduledClassForAccess } =
      await import('@/lib/server/scheduled-classes');

    const teacherScope = {
      role: 'teacher' as const,
      userId: 'teacher-1',
      organizationId: 'org-1',
    };

    const created = await createScheduledClassForAccess(
      teacherScope,
      {
        title: 'Physics game',
        startsAt: '2099-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: 'room-1',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      },
      { multiplayerInviteBaseUrl: 'https://example.test/app' },
    );

    expect(created.multiplayerGame).toEqual(
      expect.objectContaining({
        enabled: true,
        mode: 'both',
        linkPolicy: 'always_open',
        inviteExpiresAt: '2099-05-12T18:45:00.000Z',
      }),
    );
    expect(created.multiplayerGame?.inviteUrl).toMatch(/^https:\/\/example\.test\/join\//);
    expect(store.joinTokens).toHaveLength(1);
    expect(store.joinTokens[0]).toEqual(
      expect.objectContaining({
        classroomId: 'room-1',
        displayName: 'Physics game',
        expiresAt: '2099-05-12T18:45:00.000Z',
      }),
    );

    const originalJoinTokenId = created.multiplayerGame?.joinTokenId;
    const originalInviteUrl = created.multiplayerGame?.inviteUrl;
    const updatedTime = await updateScheduledClassForAccess(
      teacherScope,
      created.id,
      {
        title: 'Physics game later',
        startsAt: '2099-05-12T19:00:00.000Z',
        durationMinutes: 30,
        classroomId: 'room-1',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      },
      { multiplayerInviteBaseUrl: 'https://example.test/app' },
    );

    expect(updatedTime?.multiplayerGame?.joinTokenId).toBe(originalJoinTokenId);
    expect(updatedTime?.multiplayerGame?.inviteUrl).toBe(originalInviteUrl);
    expect(updatedTime?.multiplayerGame?.inviteExpiresAt).toBe('2099-05-12T20:30:00.000Z');
    expect(store.joinTokens[0].expiresAt).toBe('2099-05-12T20:30:00.000Z');

    const movedClassroom = await updateScheduledClassForAccess(
      teacherScope,
      created.id,
      {
        title: 'Physics game moved',
        startsAt: '2099-05-13T17:00:00.000Z',
        classroomId: 'room-2',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      },
      { multiplayerInviteBaseUrl: 'https://example.test/app' },
    );

    expect(movedClassroom?.multiplayerGame?.joinTokenId).not.toBe(originalJoinTokenId);
    expect(store.joinTokens).toHaveLength(2);
    expect(store.joinTokens[1]).toEqual(
      expect.objectContaining({
        classroomId: 'room-2',
        displayName: 'Physics game moved',
        expiresAt: '2099-05-13T19:00:00.000Z',
      }),
    );
  });
});
