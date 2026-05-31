import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const scriptPath = resolve(process.cwd(), 'scripts/production-milestone-smoke.mjs');
const fetchMockPath = resolve(
  process.cwd(),
  'tests/support/production-milestone-smoke-fetch-mock.mjs',
);

type SmokeResult = {
  code: number;
  stderr: string;
  stdout: string;
};

function runSmoke(env: Record<string, string>): Promise<SmokeResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, ['--import', fetchMockPath, scriptPath], {
      cwd: process.cwd(),
      env: {
        HOME: process.env.HOME || '',
        NODE_ENV: 'test',
        PATH: process.env.PATH || '',
        RAIC_PRODUCTION_BASE_URL: 'https://production-smoke.test',
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

describe('production milestone smoke script', () => {
  it('skips Discord readiness when the release does not require it', async () => {
    const result = await runSmoke({});

    expect(result.code).toBe(0);
    expect(result.stdout).toContain('SKIP    Discord readiness');
    expect(result.stdout).toContain('Discord beta is not required for this release');
    expect(result.stderr).toBe('');
  });

  it('blocks production smoke when Discord beta is required but not configured', async () => {
    const result = await runSmoke({ RAIC_REQUIRED_PRODUCTION_FEATURES: 'discord' });

    expect(result.code).toBe(2);
    expect(result.stdout).toContain('BLOCK   Discord readiness');
    expect(result.stdout).toContain('DISCORD_CLIENT_ID');
    expect(result.stdout).toContain('Summary: ');
    expect(result.stderr).toBe('');
  });
});
