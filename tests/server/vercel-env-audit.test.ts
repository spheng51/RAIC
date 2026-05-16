import { beforeAll, describe, expect, it } from 'vitest';

type VercelEnvAuditModule = typeof import('../../scripts/lib/vercel-env-audit.mjs');

let auditEnvRecords: VercelEnvAuditModule['auditEnvRecords'];
let manualFallbackLines: VercelEnvAuditModule['manualFallbackLines'];
let parseAuditContexts: VercelEnvAuditModule['parseAuditContexts'];
let summarizeAudit: VercelEnvAuditModule['summarizeAudit'];

beforeAll(async () => {
  ({ auditEnvRecords, manualFallbackLines, parseAuditContexts, summarizeAudit } =
    await import('../../scripts/lib/vercel-env-audit.mjs'));
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

  it('normalizes requested contexts and documents manual fallback', () => {
    expect(parseAuditContexts(' production, preview,production ')).toEqual([
      'production',
      'preview',
    ]);

    const fallback = manualFallbackLines({
      projectId: 'prj_123',
      teamId: 'team_123',
      contexts: ['production'],
    }).join('\n');

    expect(fallback).toContain('prj_123');
    expect(fallback).toContain('team_123');
    expect(fallback).toContain('Do not paste or print secret values');
  });
});
