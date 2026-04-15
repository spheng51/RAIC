import { beforeEach, describe, expect, it, vi } from 'vitest';

const findOrganizationAIPolicyMock = vi.fn();
const listOrganizationProviderConfigsMock = vi.fn();
const listUserProviderOverridesMock = vi.fn();
const getBootstrapProviderConfigMock = vi.fn();
const decryptSecretMock = vi.fn((value: string) => `decrypted:${value}`);

vi.mock('@/lib/db/repositories/organization-provider-configs', () => ({
  findOrganizationProviderConfig: vi.fn(),
  listOrganizationProviderConfigs: listOrganizationProviderConfigsMock,
  upsertOrganizationProviderConfig: vi.fn(),
}));

vi.mock('@/lib/db/repositories/user-provider-overrides', () => ({
  findUserProviderOverride: vi.fn(),
  listUserProviderOverrides: listUserProviderOverridesMock,
  upsertUserProviderOverride: vi.fn(),
}));

vi.mock('@/lib/db/repositories/audit-logs', () => ({
  appendAuditLog: vi.fn(),
}));

vi.mock('@/lib/db/repositories/organization-ai-policies', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/lib/db/repositories/organization-ai-policies')>();
  return {
    ...actual,
    findOrganizationAIPolicy: findOrganizationAIPolicyMock,
    upsertOrganizationAIPolicy: vi.fn(),
  };
});

vi.mock('@/lib/server/provider-config', () => ({
  getBootstrapProviderConfig: getBootstrapProviderConfigMock,
}));

vi.mock('@/lib/server/encrypted-secrets', () => ({
  decryptSecret: decryptSecretMock,
}));

const authContext = {
  user: { id: 'user-1' },
  organization: { id: 'org-1' },
  session: { role: 'teacher' },
} as never;

const timestamp = '2026-04-12T00:00:00.000Z';

describe('ai-governance resolver', () => {
  beforeEach(() => {
    vi.resetModules();
    findOrganizationAIPolicyMock.mockReset();
    listOrganizationProviderConfigsMock.mockReset();
    listUserProviderOverridesMock.mockReset();
    getBootstrapProviderConfigMock.mockReset();
    decryptSecretMock.mockClear();

    findOrganizationAIPolicyMock.mockResolvedValue(null);
    listOrganizationProviderConfigsMock.mockResolvedValue([]);
    listUserProviderOverridesMock.mockResolvedValue([]);
    getBootstrapProviderConfigMock.mockReturnValue(null);
  });

  it('allows org-scoped built-in providers to use legacy request credentials when no server-backed config exists', async () => {
    const { resolveGovernedProviderConfig } = await import('@/lib/server/ai-governance');

    const resolved = await resolveGovernedProviderConfig({
      auth: authContext,
      family: 'image',
      providerId: 'seedream',
      requestedSecret: 'client-image-key',
    });

    expect(resolved.apiKey).toBe('client-image-key');
    expect(resolved.source).toBe('legacy');
  });

  it('still allows ad-hoc client credentials outside organization scope', async () => {
    const { resolveGovernedProviderConfig } = await import('@/lib/server/ai-governance');

    const resolved = await resolveGovernedProviderConfig({
      auth: null,
      family: 'image',
      providerId: 'seedream',
      requestedSecret: 'client-image-key',
    });

    expect(resolved.apiKey).toBe('client-image-key');
    expect(resolved.source).toBe('legacy');
  });

  it('prefers bootstrap config over legacy request credentials when bootstrap already exists', async () => {
    getBootstrapProviderConfigMock.mockReturnValue({
      apiKey: 'bootstrap-key',
      baseUrl: 'https://bootstrap.example.com/v1',
    });

    const { resolveLLMGovernedConfig } = await import('@/lib/server/ai-governance');
    const resolved = await resolveLLMGovernedConfig({
      auth: authContext,
      providerId: 'openai',
      modelId: 'gpt-4o',
      requestedSecret: 'browser-key',
      requestedBaseUrl: 'https://browser.example.com/v1',
    });

    expect(resolved.apiKey).toBe('bootstrap-key');
    expect(resolved.baseUrl).toBe('https://bootstrap.example.com/v1');
    expect(resolved.source).toBe('bootstrap');
  });

  it('allows an org-approved provider with an organization secret', async () => {
    listOrganizationProviderConfigsMock.mockResolvedValue([
      {
        id: 'config-1',
        organizationId: 'org-1',
        family: 'llm',
        providerId: 'openai',
        providerDefinition: null,
        encryptedSecret: 'org-secret',
        baseUrl: 'https://org-llm.example.com',
        allowedModels: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    const { resolveLLMGovernedConfig } = await import('@/lib/server/ai-governance');
    const resolved = await resolveLLMGovernedConfig({
      auth: authContext,
      providerId: 'openai',
      modelId: 'gpt-4o',
    });

    expect(resolved.apiKey).toBe('decrypted:org-secret');
    expect(resolved.source).toBe('organization');
    expect(resolved.modelId).toBe('gpt-4o');
  });

  it('only applies personal overrides when org policy allows them', async () => {
    listOrganizationProviderConfigsMock.mockResolvedValue([
      {
        id: 'config-1',
        organizationId: 'org-1',
        family: 'llm',
        providerId: 'openai',
        providerDefinition: null,
        encryptedSecret: 'org-secret',
        baseUrl: 'https://org-llm.example.com',
        allowedModels: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);
    listUserProviderOverridesMock.mockResolvedValue([
      {
        id: 'override-1',
        organizationId: 'org-1',
        userId: 'user-1',
        family: 'llm',
        providerId: 'openai',
        encryptedSecret: 'user-secret',
        baseUrl: 'https://user-llm.example.com',
        preferredModel: 'gpt-4o',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    const { resolveLLMGovernedConfig } = await import('@/lib/server/ai-governance');

    findOrganizationAIPolicyMock.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      allowPersonalOverrides: false,
      allowPersonalCustomBaseUrls: false,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const withoutPersonalOverride = await resolveLLMGovernedConfig({
      auth: authContext,
      providerId: 'openai',
      modelId: 'gpt-4o',
    });

    expect(withoutPersonalOverride.apiKey).toBe('decrypted:org-secret');
    expect(withoutPersonalOverride.source).toBe('organization');

    findOrganizationAIPolicyMock.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      allowPersonalOverrides: true,
      allowPersonalCustomBaseUrls: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

    const withPersonalOverride = await resolveLLMGovernedConfig({
      auth: authContext,
      providerId: 'openai',
      modelId: 'gpt-4o',
    });

    expect(withPersonalOverride.apiKey).toBe('decrypted:user-secret');
    expect(withPersonalOverride.baseUrl).toBe('https://user-llm.example.com');
    expect(withPersonalOverride.source).toBe('personal');
  });

  it('resolves built-in personal overrides without org provider config', async () => {
    listUserProviderOverridesMock.mockResolvedValue([
      {
        id: 'override-1',
        organizationId: 'org-1',
        userId: 'user-1',
        family: 'llm',
        providerId: 'grok',
        encryptedSecret: 'user-secret',
        baseUrl: 'https://api.x.ai/v1',
        preferredModel: 'grok-4.20-reasoning',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    const { resolveLLMGovernedConfig } = await import('@/lib/server/ai-governance');
    const resolved = await resolveLLMGovernedConfig({
      auth: authContext,
      providerId: 'grok',
      modelId: 'grok-4.20-reasoning',
    });

    expect(resolved.apiKey).toBe('decrypted:user-secret');
    expect(resolved.baseUrl).toBe('https://api.x.ai/v1');
    expect(resolved.modelId).toBe('grok-4.20-reasoning');
    expect(resolved.source).toBe('personal');
  });

  it('marks legacy fallback available for built-in org-scoped providers when no server-backed config exists', async () => {
    const { getEffectiveAIOptions } = await import('@/lib/server/ai-governance');

    const options = await getEffectiveAIOptions(authContext);

    expect(options.providers.llm.openai?.legacyFallbackAllowed).toBe(true);
  });

  it('marks legacy fallback unavailable once bootstrap config exists', async () => {
    getBootstrapProviderConfigMock.mockReturnValue({
      apiKey: 'bootstrap-key',
      baseUrl: 'https://bootstrap.example.com/v1',
    });

    const { getEffectiveAIOptions } = await import('@/lib/server/ai-governance');
    const options = await getEffectiveAIOptions(authContext);

    expect(options.providers.llm.openai?.legacyFallbackAllowed).toBe(false);
  });

  it('reports built-in personal overrides without org config as personal and disables legacy fallback', async () => {
    listUserProviderOverridesMock.mockResolvedValue([
      {
        id: 'override-1',
        organizationId: 'org-1',
        userId: 'user-1',
        family: 'llm',
        providerId: 'grok',
        encryptedSecret: 'user-secret',
        baseUrl: 'https://api.x.ai/v1',
        preferredModel: 'grok-4.20-reasoning',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    ]);

    const { getEffectiveAIOptions } = await import('@/lib/server/ai-governance');
    const options = await getEffectiveAIOptions(authContext);

    expect(options.providers.llm.grok).toMatchObject({
      source: 'personal',
      legacyFallbackAllowed: false,
      hasPersonalOverride: true,
      hasOrganizationConfig: false,
      defaultModel: 'grok-4.20-reasoning',
    });
  });

  it('allows LM Studio bootstrap config without an API key', async () => {
    getBootstrapProviderConfigMock.mockReturnValue({
      baseUrl: 'http://127.0.0.1:1234/v1',
      models: ['qwen3.5-4b'],
    });

    const { resolveLLMGovernedConfig } = await import('@/lib/server/ai-governance');
    const resolved = await resolveLLMGovernedConfig({
      auth: authContext,
      providerId: 'lmstudio',
      modelId: 'qwen3.5-4b',
    });

    expect(resolved.apiKey).toBe('');
    expect(resolved.baseUrl).toBe('http://127.0.0.1:1234/v1');
    expect(resolved.modelId).toBe('qwen3.5-4b');
    expect(resolved.source).toBe('bootstrap');
  });
});
