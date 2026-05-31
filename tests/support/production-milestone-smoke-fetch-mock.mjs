function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function readyCheck(ready, reason = null) {
  return {
    ready,
    reason: ready ? null : reason,
  };
}

globalThis.fetch = async (input) => {
  const url = new URL(String(input));

  if (url.pathname === '/api/health') {
    if (process.env.RAIC_PRODUCTION_SMOKE_MOCK_HEALTH_THROW === '1') {
      throw new Error('simulated health fetch failure');
    }

    const discordReady = process.env.RAIC_PRODUCTION_SMOKE_MOCK_DISCORD_READY === '1';
    return json(200, {
      success: true,
      readiness: {
        auth: readyCheck(true),
        encryption: readyCheck(true),
        storage: { ...readyCheck(true), mode: 'postgres' },
        mirofish: readyCheck(false, 'MiroFish is not configured'),
        discord: {
          ...readyCheck(
            discordReady,
            'Discord scheduled-class beta requires DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN, and CRON_SECRET',
          ),
          clientIdConfigured: discordReady,
          clientSecretConfigured: discordReady,
          botTokenConfigured: discordReady,
          cronSecretConfigured: discordReady,
        },
      },
    });
  }

  if (url.pathname === '/api/server-providers') {
    return json(200, { success: true });
  }

  if (url.pathname === '/api/ai/options') {
    return json(200, {
      success: true,
      providers: {
        llm: {
          openai: {
            enabled: true,
            hasSecret: true,
            allowedModels: ['gpt-4o'],
          },
        },
      },
    });
  }

  if (url.pathname === '/api/generate-classroom') {
    return json(401, { success: false, errorCode: 'UNAUTHORIZED' });
  }

  if (
    url.pathname === '/api/classroom' ||
    /^\/api\/classroom\/[^/]+\/session-context$/.test(url.pathname) ||
    /^\/api\/classroom\/[^/]+\/collaboration-state$/.test(url.pathname) ||
    /^\/api\/classroom\/[^/]+\/presentation-state$/.test(url.pathname)
  ) {
    return json(404, { success: false, error: 'Classroom not found' });
  }

  return json(404, { success: false, errorCode: 'NOT_FOUND' });
};
