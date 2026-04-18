import os from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

describe('data-root helpers', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('uses the repo data directory by default', async () => {
    const { getDataPath, getDataRootDir, isHostedEphemeralDataRoot } = await import(
      '@/lib/server/data-root'
    );

    expect(getDataRootDir()).toBe(path.join(process.cwd(), 'data'));
    expect(getDataPath('platform')).toBe(path.join(process.cwd(), 'data', 'platform'));
    expect(isHostedEphemeralDataRoot()).toBe(false);
  });

  it('uses a writable temp directory on hosted serverless runtimes', async () => {
    vi.stubEnv('VERCEL', '1');

    const { getDataPath, getDataRootDir, isHostedEphemeralDataRoot } = await import(
      '@/lib/server/data-root'
    );

    expect(getDataRootDir()).toBe(path.join(os.tmpdir(), 'openraic-data'));
    expect(getDataPath('platform')).toBe(path.join(os.tmpdir(), 'openraic-data', 'platform'));
    expect(isHostedEphemeralDataRoot()).toBe(true);
  });
});
