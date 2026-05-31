import { beforeAll, describe, expect, it } from 'vitest';

type VercelEnvAuditModule = typeof import('../../scripts/lib/vercel-env-audit.mjs');

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
      requiredFeatures: 'discord',
    }).join('\n');

    expect(fallback).toContain('prj_123');
    expect(fallback).toContain('team_123');
    expect(fallback).toContain('Feature-required keys (discord)');
    expect(fallback).toContain('Do not paste or print secret values');
  });
});
