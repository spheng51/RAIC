function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function redirectedJson(status, body, url) {
  return {
    status,
    redirected: true,
    url,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
  };
}

globalThis.fetch = async (input, init = {}) => {
  const url = new URL(String(input));
  const headers = new Headers(init.headers || {});
  const cookie = headers.get('cookie') || '';

  if (process.env.RAIC_DISCORD_SMOKE_MOCK_VERCEL_PROTECTION === '1') {
    const expectedBypassToken = process.env.RAIC_DISCORD_SMOKE_MOCK_VERCEL_BYPASS_TOKEN || '';
    const hasBypass =
      expectedBypassToken &&
      url.searchParams.get('x-vercel-set-bypass-cookie') === 'true' &&
      url.searchParams.get('x-vercel-protection-bypass') === expectedBypassToken;

    if (hasBypass) {
      url.searchParams.delete('x-vercel-set-bypass-cookie');
      url.searchParams.delete('x-vercel-protection-bypass');
    } else {
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
  }

  if (url.pathname === '/api/health') {
    if (process.env.RAIC_DISCORD_SMOKE_MOCK_HEALTH_THROW === '1') {
      throw new Error('simulated Discord smoke health fetch failure');
    }

    if (process.env.RAIC_DISCORD_SMOKE_MOCK_HEALTH_REDIRECT_ERROR === '1') {
      return redirectedJson(
        502,
        { success: false, errorCode: 'UPSTREAM_REDIRECT' },
        url.toString(),
      );
    }

    if (process.env.RAIC_DISCORD_SMOKE_MOCK_HEALTH_ERROR === '1') {
      return json(503, { success: false, errorCode: 'SERVICE_UNAVAILABLE' });
    }

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

    const expectedConnectionId = process.env.RAIC_DISCORD_SMOKE_MOCK_EXPECT_SYNC_CONNECTION_ID;
    if (expectedConnectionId) {
      let body = null;
      try {
        body = init.body ? JSON.parse(String(init.body)) : null;
      } catch {
        return json(400, { success: false, errorCode: 'BAD_JSON' });
      }
      if (body?.connectionId !== expectedConnectionId) {
        return json(400, {
          success: false,
          errorCode: 'WRONG_CONNECTION',
          receivedConnectionId: body?.connectionId ?? null,
        });
      }
    }

    if (process.env.RAIC_DISCORD_SMOKE_MOCK_SYNC_WARNING_ONLY === '1') {
      return json(200, {
        success: true,
        event: {
          discordSync: {
            enabled: true,
            syncWarning: 'Discord rate limited this update.',
          },
        },
      });
    }

    if (process.env.RAIC_DISCORD_SMOKE_MOCK_SYNC_INVALID_URL === '1') {
      return json(200, {
        success: true,
        event: {
          discordSync: {
            enabled: true,
            scheduledEventUrl: 'https://evil.example/events/guild/event',
          },
        },
      });
    }

    if (process.env.RAIC_DISCORD_SMOKE_MOCK_SYNC_SECRET_URL === '1') {
      return json(200, {
        success: true,
        event: {
          discordSync: {
            enabled: true,
            scheduledEventUrl: 'https://evil.example/events/guild/event?token=sync-url-secret',
          },
        },
      });
    }

    if (process.env.RAIC_DISCORD_SMOKE_MOCK_SYNC_DISCORD_SECRET_URL === '1') {
      return json(200, {
        success: true,
        event: {
          discordSync: {
            enabled: true,
            scheduledEventUrl: 'https://discord.com/events/guild/event?token=sync-url-secret',
          },
        },
      });
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
      if (process.env.RAIC_DISCORD_SMOKE_MOCK_CRON_BAD_COUNTS === '1') {
        return json(200, { success: true, checked: '1', sent: 0, failed: 0 });
      }

      return json(200, { success: true, checked: 1, sent: 0, failed: 0 });
    }

    return json(403, { success: false, errorCode: 'FORBIDDEN' });
  }

  return json(404, { success: false, errorCode: 'NOT_FOUND' });
};
