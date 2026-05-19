import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireRequestRole: vi.fn(),
  listDiscordConnectionsForUser: vi.fn(),
  readDiscordConnectionForUser: vi.fn(),
  upsertDiscordConnection: vi.fn(),
  deleteDiscordConnectionForUser: vi.fn(),
  getDiscordConfig: vi.fn(),
  buildDiscordOAuthUrl: vi.fn(),
  exchangeDiscordOAuthCode: vi.fn(),
  getDiscordGuild: vi.fn(),
  listDiscordGuildChannels: vi.fn(),
  sendDueDiscordScheduledClassReminders: vi.fn(),
  syncScheduledClassDiscordForAccess: vi.fn(),
}));

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: mocks.requireRequestRole,
}));

vi.mock('@/lib/db/repositories/discord-connections', () => ({
  listDiscordConnectionsForUser: mocks.listDiscordConnectionsForUser,
  readDiscordConnectionForUser: mocks.readDiscordConnectionForUser,
  upsertDiscordConnection: mocks.upsertDiscordConnection,
  deleteDiscordConnectionForUser: mocks.deleteDiscordConnectionForUser,
}));

vi.mock('@/lib/server/discord', () => ({
  DISCORD_OAUTH_STATE_COOKIE: 'raic_discord_oauth_state',
  buildDiscordOAuthUrl: mocks.buildDiscordOAuthUrl,
  exchangeDiscordOAuthCode: mocks.exchangeDiscordOAuthCode,
  getDiscordGuild: mocks.getDiscordGuild,
  getDiscordConfig: mocks.getDiscordConfig,
  listDiscordGuildChannels: mocks.listDiscordGuildChannels,
}));

vi.mock('@/lib/server/scheduled-classes', () => ({
  sendDueDiscordScheduledClassReminders: mocks.sendDueDiscordScheduledClassReminders,
  syncScheduledClassDiscordForAccess: mocks.syncScheduledClassDiscordForAccess,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const authContext = {
  session: {
    id: 'teacher-session',
    kind: 'web',
    role: 'teacher',
    organizationId: 'org-1',
  },
  user: { id: 'teacher-1' },
};

describe('Discord integration routes', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    Object.values(mocks).forEach((mock) => mock.mockReset());
    mocks.requireRequestRole.mockResolvedValue(authContext);
    mocks.listDiscordGuildChannels.mockResolvedValue([
      { id: 'channel-1', name: 'announcements', type: 0 },
      { id: 'channel-2', name: 'study-hall', type: 0 },
    ]);
    mocks.exchangeDiscordOAuthCode.mockResolvedValue(undefined);
    mocks.getDiscordGuild.mockResolvedValue({ id: 'guild-1', name: 'Physics Guild' });
  });

  it('returns the teacher Discord connection and announcement channels', async () => {
    mocks.listDiscordConnectionsForUser.mockResolvedValue([
      {
        id: 'connection-1',
        ownerUserId: 'teacher-1',
        organizationId: 'org-1',
        guildId: 'guild-1',
        guildName: 'Physics Guild',
        channelId: 'channel-1',
        channelName: 'announcements',
      },
    ]);

    const { GET } = await import('@/app/api/integrations/discord/connection/route');
    const response = await GET(
      new NextRequest('http://localhost/api/integrations/discord/connection'),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.connection).toMatchObject({ id: 'connection-1', guildId: 'guild-1' });
    expect(json.channels).toEqual([
      { id: 'channel-1', name: 'announcements' },
      { id: 'channel-2', name: 'study-hall' },
    ]);
  });

  it('updates and deletes a Discord announcement channel', async () => {
    const connection = {
      id: 'connection-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      guildId: 'guild-1',
      guildName: 'Physics Guild',
      channelId: 'channel-1',
      channelName: 'announcements',
    };
    mocks.readDiscordConnectionForUser.mockResolvedValue(connection);
    mocks.listDiscordConnectionsForUser.mockResolvedValue([connection]);
    mocks.upsertDiscordConnection.mockResolvedValue({ ...connection, channelId: 'channel-2' });
    mocks.deleteDiscordConnectionForUser.mockResolvedValue(true);

    const { POST, DELETE } = await import('@/app/api/integrations/discord/connection/route');
    const postResponse = await POST(
      new NextRequest('http://localhost/api/integrations/discord/connection', {
        method: 'POST',
        body: JSON.stringify({ connectionId: 'connection-1', channelId: 'channel-2' }),
      }),
    );
    const deleteResponse = await DELETE(
      new NextRequest('http://localhost/api/integrations/discord/connection', {
        method: 'DELETE',
        body: JSON.stringify({ id: 'connection-1' }),
      }),
    );

    expect(postResponse.status).toBe(200);
    expect(mocks.upsertDiscordConnection).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: 'channel-2', channelName: 'study-hall' }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteDiscordConnectionForUser).toHaveBeenCalledWith('teacher-1', 'connection-1');
  });

  it('starts Discord OAuth only when Discord app config exists', async () => {
    const { GET } = await import('@/app/api/integrations/discord/oauth/start/route');
    mocks.getDiscordConfig.mockReturnValue(null);

    const missingResponse = await GET(
      new NextRequest('http://localhost/api/integrations/discord/oauth/start'),
    );
    expect(missingResponse.status).toBe(503);

    mocks.getDiscordConfig.mockReturnValue({
      clientId: 'client',
      clientSecret: 'secret',
      botToken: 'bot',
    });
    mocks.buildDiscordOAuthUrl.mockReturnValue('https://discord.com/oauth2/authorize?state=abc');
    const redirectResponse = await GET(
      new NextRequest('http://localhost/api/integrations/discord/oauth/start'),
    );

    expect(redirectResponse.status).toBe(307);
    expect(redirectResponse.headers.get('location')).toContain('discord.com/oauth2/authorize');
    expect(redirectResponse.headers.get('set-cookie')).toContain('raic_discord_oauth_state');
  });

  it('validates OAuth callback state and stores install metadata', async () => {
    const { GET } = await import('@/app/api/integrations/discord/oauth/callback/route');
    const response = await GET(
      new NextRequest(
        'http://localhost/api/integrations/discord/oauth/callback?state=state-1&code=code-1&guild_id=guild-1',
        {
          headers: { cookie: 'raic_discord_oauth_state=state-1' },
        },
      ),
    );

    expect(response.status).toBe(307);
    expect(response.headers.get('location')).toBe('http://localhost/studio?discord=connected');
    expect(mocks.exchangeDiscordOAuthCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'code-1' }),
    );
    expect(mocks.upsertDiscordConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerUserId: 'teacher-1',
        guildId: 'guild-1',
        guildName: 'Physics Guild',
        channelId: 'channel-1',
      }),
    );
  });

  it('runs the reminder cron behind CRON_SECRET when configured', async () => {
    vi.stubEnv('CRON_SECRET', 'cron-secret');
    mocks.sendDueDiscordScheduledClassReminders.mockResolvedValue({
      checked: 1,
      sent: 1,
      failed: 0,
    });

    const { GET } = await import('@/app/api/cron/discord-scheduled-class-reminders/route');
    const unauthorized = await GET(
      new NextRequest('http://localhost/api/cron/discord-scheduled-class-reminders'),
    );
    const authorized = await GET(
      new NextRequest('http://localhost/api/cron/discord-scheduled-class-reminders', {
        headers: { authorization: 'Bearer cron-secret' },
      }),
    );
    const json = await authorized.json();

    expect(unauthorized.status).toBe(403);
    expect(authorized.status).toBe(200);
    expect(json).toMatchObject({ checked: 1, sent: 1, failed: 0 });
  });

  it('syncs a scheduled class with Discord for the current teacher', async () => {
    mocks.syncScheduledClassDiscordForAccess.mockResolvedValue({
      id: 'event-1',
      title: 'Physics game night',
      startsAt: '2026-05-12T17:00:00.000Z',
      discordSync: { enabled: true, scheduledEventId: 'discord-event-1' },
    });

    const { POST } = await import('@/app/api/scheduled-classes/[id]/discord-sync/route');
    const response = await POST(
      new NextRequest('http://localhost/api/scheduled-classes/event-1/discord-sync'),
      {
        params: Promise.resolve({ id: 'event-1' }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.syncScheduledClassDiscordForAccess).toHaveBeenCalledWith(
      {
        role: 'teacher',
        userId: 'teacher-1',
        organizationId: 'org-1',
      },
      'event-1',
      { baseUrl: 'http://localhost' },
    );
    expect(json.event.discordSync.scheduledEventId).toBe('discord-event-1');
  });

  it('requires teacher access for connection routes', async () => {
    mocks.requireRequestRole.mockResolvedValue(
      NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/integrations/discord/connection/route');
    const response = await GET(
      new NextRequest('http://localhost/api/integrations/discord/connection'),
    );

    expect(response.status).toBe(401);
    expect(mocks.listDiscordConnectionsForUser).not.toHaveBeenCalled();
  });
});
