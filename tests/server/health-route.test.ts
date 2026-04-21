import { beforeEach, describe, expect, it, vi } from 'vitest';

const getPersistenceModeMock = vi.fn();
const runPostgresQueryMock = vi.fn();
const hasEncryptionKeyConfiguredMock = vi.fn();
const getMiroFishConfigMock = vi.fn();
const isMiroFishMultiUserEnabledMock = vi.fn();
const getMiroFishAuthoringReadinessMock = vi.fn();
const getServerWebSearchProvidersMock = vi.fn();
const getServerImageProvidersMock = vi.fn();
const getServerVideoProvidersMock = vi.fn();
const getServerTTSProvidersMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  getPersistenceMode: getPersistenceModeMock,
  runPostgresQuery: runPostgresQueryMock,
}));

vi.mock('@/lib/server/encrypted-secrets', () => ({
  hasEncryptionKeyConfigured: hasEncryptionKeyConfiguredMock,
}));

vi.mock('@/lib/server/mirofish', () => ({
  getMiroFishConfig: getMiroFishConfigMock,
  isMiroFishMultiUserEnabled: isMiroFishMultiUserEnabledMock,
}));

vi.mock('@/lib/server/mirofish-authoring', () => ({
  getMiroFishAuthoringReadiness: getMiroFishAuthoringReadinessMock,
}));

vi.mock('@/lib/server/provider-config', () => ({
  getServerWebSearchProviders: getServerWebSearchProvidersMock,
  getServerImageProviders: getServerImageProvidersMock,
  getServerVideoProviders: getServerVideoProvidersMock,
  getServerTTSProviders: getServerTTSProvidersMock,
}));

describe('GET /api/health', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    getPersistenceModeMock.mockReset();
    runPostgresQueryMock.mockReset();
    hasEncryptionKeyConfiguredMock.mockReset();
    getMiroFishConfigMock.mockReset();
    isMiroFishMultiUserEnabledMock.mockReset();
    getMiroFishAuthoringReadinessMock.mockReset();
    getServerWebSearchProvidersMock.mockReset();
    getServerImageProvidersMock.mockReset();
    getServerVideoProvidersMock.mockReset();
    getServerTTSProvidersMock.mockReset();

    getPersistenceModeMock.mockResolvedValue('json');
    runPostgresQueryMock.mockResolvedValue([]);
    hasEncryptionKeyConfiguredMock.mockReturnValue(false);
    getMiroFishConfigMock.mockReturnValue({
      baseUrl: 'https://mirofish.example',
    });
    isMiroFishMultiUserEnabledMock.mockReturnValue(false);
    getMiroFishAuthoringReadinessMock.mockReturnValue({
      authoringEnabled: false,
      authoringReady: false,
    });
    getServerWebSearchProvidersMock.mockReturnValue({});
    getServerImageProvidersMock.mockReturnValue({});
    getServerVideoProvidersMock.mockReturnValue({});
    getServerTTSProvidersMock.mockReturnValue({});
  });

  it('returns distinct readiness details for auth, storage, encryption, and MiroFish', async () => {
    vi.stubEnv('NEXT_PUBLIC_GOOGLE_CLIENT_ID', 'google-client-id');
    vi.stubEnv('RAIC_SECRET_ENCRYPTION_KEY', 'encryption-key');
    vi.stubEnv('DATABASE_URL', 'postgres://localhost/raic');
    vi.stubEnv('MIROFISH_BASE_URL', 'https://mirofish.example');
    vi.stubEnv('MIROFISH_API_BASE_URL', 'https://mirofish-api.example');
    vi.stubEnv('MIROFISH_API_KEY', 'mirofish-api-key');
    vi.stubEnv('MIROFISH_EMBED_SECRET', 'mirofish-embed-secret');

    getPersistenceModeMock.mockResolvedValue('postgres');
    hasEncryptionKeyConfiguredMock.mockReturnValue(true);
    isMiroFishMultiUserEnabledMock.mockReturnValue(true);
    getMiroFishAuthoringReadinessMock.mockReturnValue({
      authoringEnabled: true,
      authoringReady: true,
    });
    getServerWebSearchProvidersMock.mockReturnValue({ tavily: {} });
    getServerImageProvidersMock.mockReturnValue({ seedream: {} });
    getServerTTSProvidersMock.mockReturnValue({ openai: {} });

    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.capabilities).toEqual({
      webSearch: true,
      imageGeneration: true,
      videoGeneration: false,
      tts: true,
    });
    expect(body.readiness).toEqual({
      auth: {
        ready: true,
        reason: null,
        browserClientIdConfigured: true,
        serverAudienceConfigured: true,
      },
      encryption: {
        ready: true,
        reason: null,
        configured: true,
      },
      storage: {
        ready: true,
        reason: null,
        mode: 'postgres',
      },
      mirofish: {
        ready: true,
        reason: null,
        baseUrlConfigured: true,
        apiBaseUrlConfigured: true,
        apiAccessConfigured: true,
        embedSigningConfigured: true,
        multiUserEnabled: true,
        authoringEnabled: true,
        authoringReady: true,
      },
    });
    expect(runPostgresQueryMock).toHaveBeenCalledWith('SELECT 1');
  });

  it('reports readiness failures without exposing secrets', async () => {
    vi.stubEnv('MIROFISH_BASE_URL', 'https://mirofish.example');
    getPersistenceModeMock.mockRejectedValue(new Error('schema init failed'));
    getMiroFishConfigMock.mockImplementation(() => {
      throw new Error('MIROFISH_API_BASE_URL must use http or https');
    });

    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = await response.json();

    expect(body.readiness.auth.ready).toBe(false);
    expect(body.readiness.auth.reason).toContain('Google sign-in');
    expect(body.readiness.encryption.ready).toBe(false);
    expect(body.readiness.storage).toEqual({
      ready: false,
      reason: 'schema init failed',
      mode: 'json',
    });
    expect(body.readiness.mirofish.ready).toBe(false);
    expect(body.readiness.mirofish.reason).toBe('MIROFISH_API_BASE_URL must use http or https');
    expect(body.readiness.mirofish.apiAccessConfigured).toBe(false);
    expect(body.readiness.mirofish.embedSigningConfigured).toBe(false);
    expect(body.readiness.mirofish.authoringEnabled).toBe(false);
    expect(body.readiness.mirofish.authoringReady).toBe(false);
  });

  it('flags hosted JSON storage as non-durable when DATABASE_URL is unset', async () => {
    vi.stubEnv('VERCEL', '1');
    getPersistenceModeMock.mockResolvedValue('json');

    const { GET } = await import('@/app/api/health/route');
    const response = await GET();
    const body = await response.json();

    expect(body.readiness.storage).toEqual({
      ready: false,
      reason:
        'DATABASE_URL is required for durable hosted storage; JSON fallback uses temporary runtime storage only',
      mode: 'json',
    });
  });
});
