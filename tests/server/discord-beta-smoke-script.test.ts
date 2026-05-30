import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/discord-beta-smoke.mjs');
const fetchMockPath = resolve(process.cwd(), 'tests/support/discord-beta-smoke-fetch-mock.mjs');

type SmokeResult = {
  code: number;
  stderr: string;
  stdout: string;
};

function runSmoke(
  args: string[],
  env: Record<string, string>,
  options: { mockFetch?: boolean } = {},
): Promise<SmokeResult> {
  return new Promise((resolveRun, rejectRun) => {
    const nodeArgs = options.mockFetch
      ? ['--import', fetchMockPath, scriptPath, ...args]
      : [scriptPath, ...args];
    const child = spawn(process.execPath, nodeArgs, {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME || '',
        NODE_ENV: 'test',
        PATH: process.env.PATH || '',
        ...env,
      },
    });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', rejectRun);
    child.on('close', (code) => {
      resolveRun({ code: code ?? 1, stdout, stderr });
    });
  });
}

describe('discord beta smoke script', () => {
  it('prints usage without validating smoke environment', async () => {
    const result = await runSmoke(['--help'], {
      RAIC_DISCORD_SMOKE_BASE_URL: 'not a url',
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('Discord beta smoke gate');
    expect(result.stdout).toContain('RAIC_DISCORD_SMOKE_COOKIE');
    expect(result.stderr).toBe('');
  });

  it('reports invalid base URLs with a stable summary', async () => {
    const result = await runSmoke([], {
      RAIC_DISCORD_SMOKE_BASE_URL: 'not a url',
    });

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    Discord beta smoke base URL');
    expect(result.stdout).toContain('Summary: 0 automated passed, 1 failed');
    expect(result.stderr).toBe('');
  });

  it('fails by default when live Discord prerequisites are blocked', async () => {
    const result = await runSmoke(
      [],
      {
        CRON_SECRET: '',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_CRON_SECRET: '',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('PASS    /api/health');
    expect(result.stdout).toContain('BLOCK   Discord connection snapshot');
    expect(result.stdout).toContain('BLOCK   Discord reminder cron');
    expect(result.stderr).toBe('');
  });

  it('allows blocked live prerequisites when explicitly requested', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: '',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_CRON_SECRET: '',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('blocked');
    expect(result.stdout).toContain('?discord=not_configured');
    expect(result.stderr).toBe('');
  });

  it('treats Vercel deployment protection as a blocker when explicitly allowed', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: '',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_CRON_SECRET: '',
        RAIC_DISCORD_SMOKE_MOCK_VERCEL_PROTECTION: '1',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('BLOCK   Vercel deployment protection');
    expect(result.stdout).not.toContain('FAIL    /api/health');
    expect(result.stdout).not.toContain('discord/connection unauth guard');
    expect(result.stderr).toBe('');
  });

  it('uses a Vercel bypass token when preview deployment protection is enabled', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: '',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_CRON_SECRET: '',
        RAIC_DISCORD_SMOKE_MOCK_VERCEL_BYPASS_TOKEN: 'preview-bypass',
        RAIC_DISCORD_SMOKE_MOCK_VERCEL_PROTECTION: '1',
        RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN: ' preview-bypass ',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('PASS    /api/health');
    expect(result.stdout).toContain('/api/integrations/discord/connection unauth guard');
    expect(result.stdout).not.toContain('Vercel deployment protection');
    expect(result.stdout).toContain('BLOCK   Discord connection snapshot');
    expect(result.stderr).toBe('');
  });

  it('prefers and trims the smoke-specific cron secret', async () => {
    const result = await runSmoke(
      [],
      {
        CRON_SECRET: 'wrong-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_CRON_SECRET: ' smoke-secret ',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('source=RAIC_DISCORD_SMOKE_CRON_SECRET');
    expect(result.stdout).toContain('Summary: 7 automated passed, 0 failed, 0 blocked');
    expect(result.stderr).toBe('');
  });

  it('reports response details when health check fails', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_MOCK_HEALTH_ERROR: '1',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    /api/health');
    expect(result.stdout).toContain('HTTP 503');
    expect(result.stdout).toContain('errorCode=SERVICE_UNAVAILABLE');
    expect(result.stderr).toBe('');
  });

  it('fails live sync when Discord only returns a recoverable warning without an event URL', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_EVENT_ID: 'class-1',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_MOCK_SYNC_WARNING_ONLY: '1',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    Sync scheduled class');
    expect(result.stdout).toContain('scheduledEventUrl=missing');
    expect(result.stdout).toContain('syncWarning=Discord rate limited this update.');
    expect(result.stderr).toBe('');
  });
});
