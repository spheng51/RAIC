import { describe, expect, it, vi } from 'vitest';

describe('Discord API helpers', () => {
  it('builds OAuth install URLs with the scheduled-class scopes and permission bitfield', async () => {
    vi.stubEnv('DISCORD_CLIENT_ID', 'discord-client-id');
    vi.stubEnv('DISCORD_CLIENT_SECRET', 'discord-client-secret');
    vi.stubEnv('DISCORD_BOT_TOKEN', 'discord-bot-token');

    const { buildDiscordOAuthUrl, DISCORD_OAUTH_PERMISSION_BITS, DISCORD_OAUTH_SCOPES } =
      await import('@/lib/server/discord');

    const url = new URL(
      buildDiscordOAuthUrl({
        origin: 'https://preview.example.test/studio?ignored=1',
        state: 'state-token',
      }),
    );

    expect(url.origin).toBe('https://discord.com');
    expect(url.pathname).toBe('/oauth2/authorize');
    expect(url.searchParams.get('client_id')).toBe('discord-client-id');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://preview.example.test/api/integrations/discord/oauth/callback',
    );
    expect(DISCORD_OAUTH_SCOPES).toBe('bot applications.commands identify guilds');
    expect(DISCORD_OAUTH_PERMISSION_BITS).toBe('8589937664');
    expect(url.searchParams.get('scope')).toBe(DISCORD_OAUTH_SCOPES);
    expect(url.searchParams.get('permissions')).toBe(DISCORD_OAUTH_PERMISSION_BITS);
    expect(url.searchParams.get('state')).toBe('state-token');
  });
});
