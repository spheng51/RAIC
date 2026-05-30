function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers || {});
  const cookie = headers.get('cookie') || '';

  if (process.env.RAIC_DISCORD_SMOKE_MOCK_VERCEL_PROTECTION === '1') {
    return new Response(
      '<!doctype html><title>Authentication Required</title>Vercel Authentication',
      {
        status: 401,
        headers: {
          'content-type': 'text/html; charset=utf-8',
          'set-cookie': '_vercel_sso_nonce=test; Path=/; Secure; HttpOnly; SameSite=Lax',
        },
      },
    );
  }

  if (url.pathname === '/api/health') {
    return json(200, { success: true });
  }

  if (url.pathname === '/api/integrations/discord/connection') {
    if (!cookie) {
      return json(401, { success: false, errorCode: 'UNAUTHORIZED' });
    }

    return json(200, {
      success: true,
      configured: true,
      connection: {
        id: 'connection-1',
        guildName: 'Smoke Guild',
        channelId: 'channel-1',
        channelName: 'announcements',
      },
      channels: [{ id: 'channel-1', name: 'announcements' }],
    });
  }

  if (/^\/api\/scheduled-classes\/[^/]+\/discord-sync$/.test(url.pathname)) {
    if (!cookie) {
      return json(401, { success: false, errorCode: 'UNAUTHORIZED' });
    }

    return json(200, {
      success: true,
      event: {
        discordSync: {
          enabled: true,
          scheduledEventUrl: 'https://discord.com/events/guild/event',
        },
      },
    });
  }

  if (url.pathname === '/api/cron/discord-scheduled-class-reminders') {
    const expectedSecret = process.env.RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET || '';
    if (expectedSecret && headers.get('authorization') === `Bearer ${expectedSecret}`) {
      return json(200, { success: true, checked: 1, sent: 0, failed: 0 });
    }

    return json(403, { success: false, errorCode: 'FORBIDDEN' });
  }

  return json(404, { success: false, errorCode: 'NOT_FOUND' });
};
