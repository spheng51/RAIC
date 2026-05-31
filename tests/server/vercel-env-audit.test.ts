import { spawn } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, dirname, join, resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

type VercelEnvAuditModule = typeof import('../../scripts/lib/vercel-env-audit.mjs');

const scriptPath = resolve(process.cwd(), 'scripts/vercel-env-audit.mjs');

type ScriptResult = {
  code: number;
  stderr: string;
  stdout: string;
};

let auditEnvRecords: VercelEnvAuditModule['auditEnvRecords'];
let manualFallbackLines: VercelEnvAuditModule['manualFallbackLines'];
let parseAuditContexts: VercelEnvAuditModule['parseAuditContexts'];
let parseRequiredFeatures: VercelEnvAuditModule['parseRequiredFeatures'];
let parseVercelEnvListJson: VercelEnvAuditModule['parseVercelEnvListJson'];
let sanitizeEnvRecords: VercelEnvAuditModule['sanitizeEnvRecords'];
let summarizeAudit: VercelEnvAuditModule['summarizeAudit'];

beforeAll(async () => {
  ({
    auditEnvRecords,
    manualFallbackLines,
    parseAuditContexts,
    parseRequiredFeatures,
    parseVercelEnvListJson,
    sanitizeEnvRecords,
    summarizeAudit,
  } = await import('../../scripts/lib/vercel-env-audit.mjs'));
});

function runEnvAuditScript(env: Record<string, string>): Promise<ScriptResult> {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(process.execPath, [scriptPath], {
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

async function createMockNpx(
  tempDir: string,
  stdout: string,
  options: { exitCode?: number; stderr?: string } = {},
) {
  const capturePath = join(tempDir, 'npx-capture.json');
  const npxPath = join(tempDir, 'npx');
  await writeFile(
    npxPath,
    `#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.NPX_MOCK_CAPTURE_PATH, JSON.stringify({
  argv: process.argv.slice(2),
  path: process.env.PATH,
  telemetry: process.env.VERCEL_TELEMETRY_DISABLED
}));
if (${JSON.stringify(options.stderr || '')}) {
  process.stderr.write(${JSON.stringify(options.stderr || '')});
}
console.log(${JSON.stringify(stdout)});
process.exit(${options.exitCode ?? 0});
`,
  );
  await chmod(npxPath, 0o755);
  return { capturePath };
}

describe('Vercel env audit helpers', () => {
  it('reports missing required keys without reading or returning secret values', () => {
    const [result] = auditEnvRecords({
      contexts: ['production'],
      envRecords: [
        { key: 'DATABASE_URL', target: ['production'], value: 'postgres://secret' },
        { key: 'OPENAI_API_KEY', target: ['production'], value: 'sk-secret' },
      ],
    });

    expect(result.context).toBe('production');
    expect(result.missingRequiredKeys).toEqual([
      'RAIC_SECRET_ENCRYPTION_KEY',
      'BLOB_READ_WRITE_TOKEN',
      'NEXT_PUBLIC_GOOGLE_CLIENT_ID',
      'GOOGLE_CLIENT_ID',
    ]);
    expect(result.presentLlmProviderKeys).toEqual(['OPENAI_API_KEY']);
    expect(JSON.stringify(result)).not.toContain('postgres://secret');
    expect(JSON.stringify(result)).not.toContain('sk-secret');
  });

  it('passes when all required production keys and one LLM provider key are present', () => {
    const auditResults = auditEnvRecords({
      contexts: ['production'],
      envRecords: [
        { key: 'DATABASE_URL', target: ['production'] },
        { key: 'RAIC_SECRET_ENCRYPTION_KEY', target: ['production'] },
        { key: 'BLOB_READ_WRITE_TOKEN', target: ['production'] },
        { key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', target: ['production'] },
        { key: 'GOOGLE_CLIENT_ID', target: ['production'] },
        { key: 'ANTHROPIC_API_KEY', target: ['production'] },
      ],
    });

    expect(auditResults[0].ok).toBe(true);
    expect(summarizeAudit(auditResults).ok).toBe(true);
  });

  it('tracks contexts independently', () => {
    const auditResults = auditEnvRecords({
      contexts: ['production', 'preview'],
      envRecords: [
        { key: 'DATABASE_URL', target: ['production', 'preview'] },
        { key: 'RAIC_SECRET_ENCRYPTION_KEY', target: ['production'] },
        { key: 'BLOB_READ_WRITE_TOKEN', target: ['production'] },
        { key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', target: ['production'] },
        { key: 'GOOGLE_CLIENT_ID', target: ['production'] },
        { key: 'OPENAI_API_KEY', target: ['production'] },
      ],
    });

    expect(auditResults[0].context).toBe('production');
    expect(auditResults[0].ok).toBe(true);
    expect(auditResults[1].context).toBe('preview');
    expect(auditResults[1].ok).toBe(false);
    expect(auditResults[1].missingRequiredKeys).toContain('BLOB_READ_WRITE_TOKEN');
  });

  it('requires Discord beta env keys only when the feature is requested', () => {
    const auditResults = auditEnvRecords({
      contexts: ['preview'],
      requiredFeatures: 'discord-scheduled-classes',
      envRecords: [
        { key: 'DATABASE_URL', target: ['preview'], value: 'postgres://secret' },
        { key: 'RAIC_SECRET_ENCRYPTION_KEY', target: ['preview'], value: 'encryption-secret' },
        { key: 'BLOB_READ_WRITE_TOKEN', target: ['preview'], value: 'blob-secret' },
        { key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', target: ['preview'], value: 'public-client' },
        { key: 'GOOGLE_CLIENT_ID', target: ['preview'], value: 'google-client-secret' },
        { key: 'OPENAI_API_KEY', target: ['preview'], value: 'sk-secret' },
        { key: 'DISCORD_CLIENT_ID', target: ['preview'], value: 'discord-client' },
        { key: 'DISCORD_BOT_TOKEN', target: ['preview'], value: 'discord-bot-secret' },
      ],
    });

    expect(auditResults[0].ok).toBe(false);
    expect(auditResults[0].requiredFeatureEnvs).toEqual([
      {
        feature: 'discord',
        label: 'Discord scheduled-class beta',
        required: [
          { key: 'DISCORD_CLIENT_ID', present: true },
          { key: 'DISCORD_CLIENT_SECRET', present: false },
          { key: 'DISCORD_BOT_TOKEN', present: true },
          { key: 'CRON_SECRET', present: false },
        ],
        missingRequiredKeys: ['DISCORD_CLIENT_SECRET', 'CRON_SECRET'],
        ok: false,
      },
    ]);
    expect(JSON.stringify(auditResults[0])).not.toContain('discord-bot-secret');
  });

  it('sanitizes Vercel CLI env JSON down to key and target metadata', () => {
    const records = parseVercelEnvListJson(
      JSON.stringify([
        {
          configurationId: 'env_1',
          key: 'DISCORD_BOT_TOKEN',
          target: ['preview'],
          type: 'encrypted',
          value: 'discord-bot-secret',
        },
        {
          configurationId: 'env_2',
          key: 'CRON_SECRET',
          target: ['preview', 'production'],
          type: 'encrypted',
          updatedAt: 1780186912,
        },
      ]),
    );

    expect(records).toEqual([
      { key: 'DISCORD_BOT_TOKEN', target: ['preview'] },
      { key: 'CRON_SECRET', target: ['preview', 'production'] },
    ]);
    expect(JSON.stringify(records)).not.toContain('discord-bot-secret');
    expect(JSON.stringify(records)).not.toContain('configurationId');
  });

  it('sanitizes REST env records before audit output is summarized', () => {
    const records = sanitizeEnvRecords([
      { key: 'DATABASE_URL', targets: ['production'], value: 'postgres://secret' },
      { key: 'OPENAI_API_KEY', target: 'production', value: 'sk-secret' },
    ]);

    expect(records).toEqual([
      { key: 'DATABASE_URL', targets: ['production'] },
      { key: 'OPENAI_API_KEY', target: 'production' },
    ]);
    expect(
      JSON.stringify(auditEnvRecords({ contexts: ['production'], envRecords: records })),
    ).not.toContain('postgres://secret');
  });

  it('passes Discord beta env checks when all feature keys are present', () => {
    const auditResults = auditEnvRecords({
      contexts: ['preview'],
      requiredFeatures: parseRequiredFeatures('discord-beta').join(','),
      envRecords: [
        { key: 'DATABASE_URL', target: ['preview'] },
        { key: 'RAIC_SECRET_ENCRYPTION_KEY', target: ['preview'] },
        { key: 'BLOB_READ_WRITE_TOKEN', target: ['preview'] },
        { key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', target: ['preview'] },
        { key: 'GOOGLE_CLIENT_ID', target: ['preview'] },
        { key: 'OPENAI_API_KEY', target: ['preview'] },
        { key: 'DISCORD_CLIENT_ID', target: ['preview'] },
        { key: 'DISCORD_CLIENT_SECRET', target: ['preview'] },
        { key: 'DISCORD_BOT_TOKEN', target: ['preview'] },
        { key: 'CRON_SECRET', target: ['preview'] },
      ],
    });

    expect(auditResults[0].ok).toBe(true);
    expect(auditResults[0].requiredFeatureEnvs[0].ok).toBe(true);
    expect(summarizeAudit(auditResults).ok).toBe(true);
  });

  it('fails closed for unknown required feature names', () => {
    const auditResults = auditEnvRecords({
      contexts: ['production'],
      requiredFeatures: 'unknown-feature',
      envRecords: [
        { key: 'DATABASE_URL', target: ['production'] },
        { key: 'RAIC_SECRET_ENCRYPTION_KEY', target: ['production'] },
        { key: 'BLOB_READ_WRITE_TOKEN', target: ['production'] },
        { key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', target: ['production'] },
        { key: 'GOOGLE_CLIENT_ID', target: ['production'] },
        { key: 'OPENAI_API_KEY', target: ['production'] },
      ],
    });

    expect(auditResults[0].ok).toBe(false);
    expect(auditResults[0].unknownRequiredFeatures).toEqual(['unknown-feature']);
    expect(summarizeAudit(auditResults).ok).toBe(false);
  });

  it('normalizes requested contexts and documents manual fallback', () => {
    expect(parseAuditContexts(' production, preview,production ')).toEqual([
      'production',
      'preview',
    ]);
    expect(parseRequiredFeatures('discord-scheduled-classes, discord_beta,discord')).toEqual([
      'discord',
    ]);

    const fallback = manualFallbackLines({
      projectId: 'prj_123',
      teamId: 'team_123',
      contexts: ['production'],
      requiredFeatures: 'discord, discord-betaa',
    }).join('\n');

    expect(fallback).toContain('prj_123');
    expect(fallback).toContain('team_123');
    expect(fallback).toContain('Unknown required feature: discord-betaa');
    expect(fallback).toContain('Feature-required keys (discord)');
    expect(fallback).toContain('Do not paste or print secret values');
  });

  it('does not leak CLI stderr when the fallback command fails', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'raic-vercel-env-audit-'));
    try {
      const { capturePath } = await createMockNpx(tempDir, '', {
        exitCode: 1,
        stderr: 'failed with token discord-bot-secret',
      });

      const result = await runEnvAuditScript({
        NPX_MOCK_CAPTURE_PATH: capturePath,
        PATH: [tempDir, dirname(process.execPath), process.env.PATH || ''].join(delimiter),
        VERCEL_ENV_AUDIT_SOURCE: 'cli',
      });
      const capture = JSON.parse(await readFile(capturePath, 'utf8'));

      expect(result.code).toBe(2);
      expect(result.stderr).toContain('Vercel CLI env listing failed: exitCode=1');
      expect(result.stderr).toContain('Manual fallback');
      expect(result.stderr).not.toContain('discord-bot-secret');
      expect(result.stdout).toBe('');
      expect(capture.telemetry).toBe('1');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});

describe('Vercel env audit script boundary', () => {
  it('uses the Vercel CLI fallback without leaking CLI env values', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'raic-vercel-env-audit-'));
    try {
      const cliEnvJson = JSON.stringify([
        { key: 'DATABASE_URL', target: ['preview'], value: 'postgres://secret' },
        { key: 'RAIC_SECRET_ENCRYPTION_KEY', target: ['preview'], value: 'encryption-secret' },
        { key: 'BLOB_READ_WRITE_TOKEN', target: ['preview'], value: 'blob-secret' },
        { key: 'NEXT_PUBLIC_GOOGLE_CLIENT_ID', target: ['preview'], value: 'public-client' },
        { key: 'GOOGLE_CLIENT_ID', target: ['preview'], value: 'google-secret' },
        { key: 'OPENAI_API_KEY', target: ['preview'], value: 'sk-secret' },
        { key: 'DISCORD_CLIENT_ID', target: ['preview'], value: 'discord-client-id' },
        { key: 'DISCORD_CLIENT_SECRET', target: ['preview'], value: 'discord-client-secret' },
        { key: 'DISCORD_BOT_TOKEN', target: ['preview'], value: 'discord-bot-secret' },
        { key: 'CRON_SECRET', target: ['preview'], value: 'cron-secret' },
      ]);
      const { capturePath } = await createMockNpx(tempDir, cliEnvJson);
      const testPath = [tempDir, dirname(process.execPath), process.env.PATH || ''].join(delimiter);

      const result = await runEnvAuditScript({
        NPX_MOCK_CAPTURE_PATH: capturePath,
        PATH: testPath,
        VERCEL_API_TOKEN: '',
        VERCEL_ENV_AUDIT_CONTEXTS: 'preview',
        VERCEL_ENV_AUDIT_REQUIRED_FEATURES: 'discord',
        VERCEL_TOKEN: '',
      });
      const capture = JSON.parse(await readFile(capturePath, 'utf8'));

      expect(result.code).toBe(0);
      expect(result.stdout).toContain('Source: Vercel CLI');
      expect(result.stdout).toContain('PASS DISCORD_BOT_TOKEN (discord)');
      expect(result.stdout).toContain('Environment audit passed without exposing secret values');
      expect(result.stderr).toBe('');
      expect(result.stdout).not.toContain('discord-bot-secret');
      expect(result.stdout).not.toContain('postgres://secret');
      expect(result.stderr).not.toContain('discord-bot-secret');
      expect(capture.argv).toEqual([
        '-y',
        'vercel',
        'env',
        'ls',
        '--format',
        'json',
        '--non-interactive',
      ]);
      expect(capture.path).toBe(testPath);
      expect(capture.telemetry).toBe('1');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it('does not invoke the CLI fallback when API source is explicitly required', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'raic-vercel-env-audit-'));
    try {
      const { capturePath } = await createMockNpx(tempDir, '[]');

      const result = await runEnvAuditScript({
        NPX_MOCK_CAPTURE_PATH: capturePath,
        PATH: [tempDir, dirname(process.execPath), process.env.PATH || ''].join(delimiter),
        VERCEL_API_TOKEN: '',
        VERCEL_ENV_AUDIT_SOURCE: 'api',
        VERCEL_PROJECT_ID: 'prj_123',
        VERCEL_TOKEN: '',
      });
      const capture = await readFile(capturePath, 'utf8').catch(() => '');

      expect(result.code).toBe(2);
      expect(result.stderr).toContain(
        'VERCEL_TOKEN or VERCEL_API_TOKEN is required for automatic env auditing',
      );
      expect(result.stderr).toContain('Manual fallback');
      expect(result.stdout).toBe('');
      expect(capture).toBe('');
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
