import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
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

  it('reports invalid base URLs with sanitized evidence instead of a stack trace', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'raic-production-smoke-invalid-'));
    const evidencePath = join(tmp, 'nested', 'evidence.json');

    try {
      const result = await runSmoke({
        RAIC_PRODUCTION_BASE_URL: 'not a url prod-url-secret',
        RAIC_PRODUCTION_SMOKE_EVIDENCE_PATH: evidencePath,
      });
      const rawEvidence = await readFile(evidencePath, 'utf8');
      const evidence = JSON.parse(rawEvidence);

      expect(result.code).toBe(1);
      expect(result.stdout).toContain('FAIL    Production milestone smoke base URL');
      expect(result.stdout).toContain('Summary: 0 passed, 1 failed, 0 blocked, 0 skipped');
      expect(evidence.summary).toEqual({
        blocked: 0,
        failed: 1,
        passed: 0,
        skipped: 0,
      });
      expect(evidence.exitCode).toBe(1);
      expect(rawEvidence).not.toContain('prod-url-secret');
      expect(result.stdout).not.toContain('prod-url-secret');
      expect(result.stderr).toBe('');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it('writes sanitized JSON evidence for required Discord blockers', async () => {
    const tmp = await mkdtemp(join(tmpdir(), 'raic-production-smoke-'));
    const evidencePath = join(tmp, 'nested', 'evidence.json');

    try {
      const result = await runSmoke({
        RAIC_PRODUCTION_BASE_URL: 'https://production-smoke.test?token=prod-url-secret',
        RAIC_PRODUCTION_SMOKE_EVIDENCE_PATH: evidencePath,
        RAIC_REQUIRED_PRODUCTION_FEATURES: 'discord',
      });
      const rawEvidence = await readFile(evidencePath, 'utf8');
      const evidence = JSON.parse(rawEvidence);

      expect(result.code).toBe(2);
      expect(result.stdout).toContain(`Evidence JSON: ${evidencePath}`);
      expect(evidence.script).toBe('production-milestone-smoke');
      expect(evidence.baseUrl).toBe('https://production-smoke.test/');
      expect(evidence.preconditions).toMatchObject({
        missingClassroomId: 'missing-milestone-smoke-404',
        requiredDiscord: true,
        requiredMiroFish: false,
        requiredProductionFeatures: ['discord'],
      });
      expect(evidence.summary).toEqual({
        blocked: 1,
        failed: 0,
        passed: 9,
        skipped: 6,
      });
      expect(evidence.exitCode).toBe(2);
      expect(rawEvidence).not.toContain('prod-url-secret');
      expect(result.stderr).toBe('');
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
