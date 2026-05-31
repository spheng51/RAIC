import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

  it('writes sanitized JSON evidence for invalid base URLs', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'raic-discord-smoke-invalid-'));
    const evidencePath = join(tmp, 'nested', 'evidence.json');

    try {
      const result = await runSmoke([], {
        RAIC_DISCORD_SMOKE_BASE_URL: 'not a url discord-url-secret',
        RAIC_DISCORD_SMOKE_EVIDENCE_PATH: evidencePath,
      });
      const rawEvidence = await readFile(evidencePath, 'utf8');
      const evidence = JSON.parse(rawEvidence);

      expect(result.code).toBe(1);
      expect(result.stdout).toContain('FAIL    Discord beta smoke base URL');
      expect(result.stdout).toContain('Summary: 0 automated passed, 1 failed');
      expect(evidence.summary).toEqual({
        automatedPassed: 0,
        blocked: 0,
        failed: 1,
        manual: 0,
      });
      expect(evidence.exitCode).toBe(1);
      expect(rawEvidence).not.toContain('discord-url-secret');
      expect(result.stdout).not.toContain('discord-url-secret');
      expect(result.stderr).toBe('');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
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

  it('writes sanitized JSON evidence without changing blocker exit semantics', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'raic-discord-smoke-'));
    const evidencePath = join(tmp, 'nested', 'evidence.json');

    try {
      const result = await runSmoke(
        ['--allow-blockers'],
        {
          CRON_SECRET: '',
          RAIC_DISCORD_SMOKE_BASE_URL:
            'https://smoke-user:discord-base-secret@smoke.test?token=discord-url-secret',
          RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher-cookie-secret',
          RAIC_DISCORD_SMOKE_CRON_SECRET: '',
          RAIC_DISCORD_SMOKE_EVIDENCE_PATH: evidencePath,
          RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN: 'preview-bypass-secret',
        },
        { mockFetch: true },
      );
      const rawEvidence = await readFile(evidencePath, 'utf8');
      const evidence = JSON.parse(rawEvidence);

      expect(result.code).toBe(0);
      expect(result.stdout).toContain(`Evidence JSON: ${evidencePath}`);
      expect(evidence.script).toBe('discord-beta-smoke');
      expect(evidence.baseUrl).toBe('https://smoke.test/');
      expect(evidence.allowBlockers).toBe(true);
      expect(evidence.preconditions).toMatchObject({
        cronSecretSource: null,
        hasTeacherCookie: true,
        hasVercelBypassToken: true,
      });
      expect(evidence.summary).toEqual({
        automatedPassed: 7,
        blocked: 1,
        failed: 0,
        manual: 7,
      });
      expect(evidence.exitCode).toBe(0);
      expect(rawEvidence).not.toContain('teacher-cookie-secret');
      expect(rawEvidence).not.toContain('preview-bypass-secret');
      expect(rawEvidence).not.toContain('discord-base-secret');
      expect(rawEvidence).not.toContain('discord-url-secret');
      expect(result.stdout).not.toContain('discord-base-secret');
      expect(result.stdout).not.toContain('discord-url-secret');
      expect(result.stderr).toBe('');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
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
    expect(result.stdout).toContain('/api/cron/discord-scheduled-class-reminders unauth guard');
    expect(result.stdout).toContain('Summary: 8 automated passed, 0 failed, 0 blocked');
    expect(result.stderr).toBe('');
  });

  it('falls back to CRON_SECRET when the smoke-specific cron secret is blank', async () => {
    const result = await runSmoke(
      [],
      {
        CRON_SECRET: 'fallback-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_CRON_SECRET: '   ',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'fallback-secret',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('source=CRON_SECRET');
    expect(result.stdout).not.toContain('source=RAIC_DISCORD_SMOKE_CRON_SECRET');
    expect(result.stderr).toBe('');
  });

  it('passes the selected Discord connection id during scheduled-class sync', async () => {
    const result = await runSmoke(
      [],
      {
        CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_CONNECTION_ID: 'connection-2',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_EVENT_ID: 'class-1',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_MOCK_EXPECT_SYNC_CONNECTION_ID: 'connection-2',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('PASS    Sync scheduled class');
    expect(result.stdout).toContain('Summary: 9 automated passed, 0 failed, 0 blocked');
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

  it('writes evidence when a Discord smoke request fails at runtime', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'raic-discord-smoke-runtime-'));
    const evidencePath = join(tmp, 'nested', 'evidence.json');

    try {
      const result = await runSmoke(
        ['--allow-blockers'],
        {
          RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
          RAIC_DISCORD_SMOKE_EVIDENCE_PATH: evidencePath,
          RAIC_DISCORD_SMOKE_MOCK_HEALTH_THROW: '1',
        },
        { mockFetch: true },
      );
      const rawEvidence = await readFile(evidencePath, 'utf8');
      const evidence = JSON.parse(rawEvidence);

      expect(result.code).toBe(1);
      expect(result.stdout).toContain('FAIL    Discord beta smoke runtime');
      expect(result.stdout).toContain('simulated Discord smoke health fetch failure');
      expect(result.stdout).toContain('Summary: 0 automated passed, 1 failed');
      expect(evidence.summary).toEqual({
        automatedPassed: 0,
        blocked: 0,
        failed: 1,
        manual: 0,
      });
      expect(evidence.results).toEqual([
        expect.objectContaining({
          label: 'Discord beta smoke runtime',
          status: 'fail',
        }),
      ]);
      expect(evidence.exitCode).toBe(1);
      expect(result.stderr).toBe('');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('redacts Vercel bypass tokens from redirected response diagnostics', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_MOCK_HEALTH_REDIRECT_ERROR: '1',
        RAIC_DISCORD_SMOKE_VERCEL_BYPASS_TOKEN: 'preview-bypass-secret',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    /api/health');
    expect(result.stdout).toContain('redirected to');
    expect(result.stdout).toContain('x-vercel-protection-bypass=redacted');
    expect(result.stdout).not.toContain('preview-bypass-secret');
    expect(result.stderr).not.toContain('preview-bypass-secret');
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

  it('fails live sync when Discord returns a non-Discord scheduled event URL', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_EVENT_ID: 'class-1',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_MOCK_SYNC_INVALID_URL: '1',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    Sync scheduled class');
    expect(result.stdout).toContain('expected Discord scheduled event URL');
    expect(result.stdout).toContain('scheduledEventUrl=https://evil.example/events/guild/event');
    expect(result.stderr).toBe('');
  });

  it('redacts sensitive scheduled event URL params from sync failure output', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_EVENT_ID: 'class-1',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_MOCK_SYNC_SECRET_URL: '1',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    Sync scheduled class');
    expect(result.stdout).toContain(
      'scheduledEventUrl=https://evil.example/events/guild/event?token=redacted',
    );
    expect(result.stdout).not.toContain('sync-url-secret');
    expect(result.stderr).not.toContain('sync-url-secret');
  });

  it('rejects Discord scheduled event URLs with sensitive params', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_EVENT_ID: 'class-1',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_MOCK_SYNC_DISCORD_SECRET_URL: '1',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    Sync scheduled class');
    expect(result.stdout).toContain(
      'scheduledEventUrl=https://discord.com/events/guild/event?token=redacted',
    );
    expect(result.stdout).not.toContain('sync-url-secret');
    expect(result.stderr).not.toContain('sync-url-secret');
  });

  it('fails reminder cron when the API returns malformed count fields', async () => {
    const result = await runSmoke(
      ['--allow-blockers'],
      {
        CRON_SECRET: 'smoke-secret',
        RAIC_DISCORD_SMOKE_BASE_URL: 'https://smoke.test',
        RAIC_DISCORD_SMOKE_COOKIE: 'session=teacher',
        RAIC_DISCORD_SMOKE_CRON_SECRET: ' smoke-secret ',
        RAIC_DISCORD_SMOKE_MOCK_CRON_BAD_COUNTS: '1',
        RAIC_DISCORD_SMOKE_MOCK_CRON_SECRET: 'smoke-secret',
      },
      { mockFetch: true },
    );

    expect(result.code).toBe(1);
    expect(result.stdout).toContain('FAIL    Discord reminder cron');
    expect(result.stdout).toContain('expected cron result counts');
    expect(result.stdout).toContain('HTTP 200');
    expect(result.stderr).toBe('');
  });
});
