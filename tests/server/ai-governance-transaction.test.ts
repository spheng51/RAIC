import { beforeEach, describe, expect, it, vi } from 'vitest';

const runPostgresTransactionMock = vi.fn();
const updatePlatformStoreMock = vi.fn();

const appendAuditLogMock = vi.fn();

const findOrganizationAIPolicyMock = vi.fn();
const upsertOrganizationAIPolicyMock = vi.fn();

const findOrganizationProviderConfigMock = vi.fn();
const listOrganizationProviderConfigsMock = vi.fn();
const upsertOrganizationProviderConfigMock = vi.fn();

const findUserProviderOverrideMock = vi.fn();
const listUserProviderOverridesMock = vi.fn();
const upsertUserProviderOverrideMock = vi.fn();

const encryptSecretMock = vi.fn((value: string) => `enc:${value}`);
const decryptSecretMock = vi.fn((value: string) => value);
const getBootstrapProviderConfigMock = vi.fn();

vi.mock('@/lib/db/client', () => ({
  runPostgresTransaction: runPostgresTransactionMock,
  updatePlatformStore: updatePlatformStoreMock,
}));

vi.mock('@/lib/db/repositories/audit-logs', () => ({
  appendAuditLog: appendAuditLogMock,
}));

vi.mock('@/lib/db/repositories/organization-ai-policies', () => ({
  findOrganizationAIPolicy: findOrganizationAIPolicyMock,
  upsertOrganizationAIPolicy: upsertOrganizationAIPolicyMock,
}));

vi.mock('@/lib/db/repositories/organization-provider-configs', () => ({
  findOrganizationProviderConfig: findOrganizationProviderConfigMock,
  listOrganizationProviderConfigs: listOrganizationProviderConfigsMock,
  upsertOrganizationProviderConfig: upsertOrganizationProviderConfigMock,
}));

vi.mock('@/lib/db/repositories/user-provider-overrides', () => ({
  findUserProviderOverride: findUserProviderOverrideMock,
  listUserProviderOverrides: listUserProviderOverridesMock,
  upsertUserProviderOverride: upsertUserProviderOverrideMock,
}));

vi.mock('@/lib/server/encrypted-secrets', () => ({
  encryptSecret: encryptSecretMock,
  decryptSecret: decryptSecretMock,
}));

vi.mock('@/lib/server/provider-config', () => ({
  getBootstrapProviderConfig: getBootstrapProviderConfigMock,
}));

const orgAdminAuth = {
  user: { id: 'admin-1' },
  session: { role: 'org_admin' },
  organization: { id: 'org-1' },
} as never;

const teacherAuth = {
  user: { id: 'teacher-1' },
  session: { role: 'teacher' },
  organization: { id: 'org-1' },
} as never;

const timestamp = '2026-04-12T00:00:00.000Z';

describe('ai-governance transactional saves', () => {
  beforeEach(() => {
    vi.resetModules();
    runPostgresTransactionMock.mockReset();
    updatePlatformStoreMock.mockReset();

    appendAuditLogMock.mockReset();

    findOrganizationAIPolicyMock.mockReset();
    upsertOrganizationAIPolicyMock.mockReset();

    findOrganizationProviderConfigMock.mockReset();
    listOrganizationProviderConfigsMock.mockReset();
    upsertOrganizationProviderConfigMock.mockReset();

    findUserProviderOverrideMock.mockReset();
    listUserProviderOverridesMock.mockReset();
    upsertUserProviderOverrideMock.mockReset();

    encryptSecretMock.mockClear();
    decryptSecretMock.mockClear();
    getBootstrapProviderConfigMock.mockReset();
    getBootstrapProviderConfigMock.mockReturnValue(null);
  });

  it('uses runPostgresTransaction for admin config snapshots', async () => {
    const fakeExecutor = { unsafe: vi.fn() };
    const savedPolicy = {
      id: 'policy-1',
      organizationId: 'org-1',
      allowPersonalOverrides: true,
      allowPersonalCustomBaseUrls: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const savedConfig = {
      id: 'config-1',
      organizationId: 'org-1',
      family: 'llm',
      providerId: 'openai',
      providerDefinition: null,
      encryptedSecret: 'enc:org-secret',
      baseUrl: null,
      allowedModels: ['gpt-4o'],
      defaultModel: 'gpt-4o',
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    runPostgresTransactionMock.mockImplementation(async (handler) => handler(fakeExecutor));
    upsertOrganizationAIPolicyMock.mockResolvedValue(savedPolicy);
    findOrganizationProviderConfigMock.mockResolvedValue(null);
    upsertOrganizationProviderConfigMock.mockResolvedValue(savedConfig);
    appendAuditLogMock.mockResolvedValue({ id: 'audit-1' });
    findOrganizationAIPolicyMock.mockResolvedValue(savedPolicy);
    listOrganizationProviderConfigsMock.mockResolvedValue([savedConfig]);
    listUserProviderOverridesMock.mockResolvedValue([]);

    const { saveAdminConfigSnapshot } = await import('@/lib/server/ai-governance');
    const snapshot = await saveAdminConfigSnapshot(orgAdminAuth, {
      policy: {
        allowPersonalOverrides: true,
        allowPersonalCustomBaseUrls: true,
      },
      configs: [
        {
          family: 'llm',
          providerId: 'openai',
          enabled: true,
          allowedModels: ['gpt-4o'],
          defaultModel: 'gpt-4o',
          secret: 'org-secret',
        },
      ],
    });

    expect(runPostgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(updatePlatformStoreMock).not.toHaveBeenCalled();
    expect(upsertOrganizationAIPolicyMock).toHaveBeenCalledWith(
      {
        organizationId: 'org-1',
        allowPersonalOverrides: true,
        allowPersonalCustomBaseUrls: true,
      },
      fakeExecutor,
    );
    expect(upsertOrganizationProviderConfigMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        family: 'llm',
        providerId: 'openai',
        encryptedSecret: 'enc:org-secret',
      }),
      fakeExecutor,
    );
    expect(snapshot.policy.allowPersonalOverrides).toBe(true);
    expect(snapshot.configs).toHaveLength(1);
  });

  it('does not fall back to JSON writes when an admin transaction step throws', async () => {
    const fakeExecutor = { unsafe: vi.fn() };

    runPostgresTransactionMock.mockImplementation(async (handler) => handler(fakeExecutor));
    upsertOrganizationAIPolicyMock.mockResolvedValue({
      id: 'policy-1',
      organizationId: 'org-1',
      allowPersonalOverrides: true,
      allowPersonalCustomBaseUrls: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    findOrganizationProviderConfigMock.mockResolvedValue(null);
    upsertOrganizationProviderConfigMock
      .mockResolvedValueOnce({
        id: 'config-1',
        organizationId: 'org-1',
        family: 'llm',
        providerId: 'openai',
        providerDefinition: null,
        encryptedSecret: 'enc:first',
        baseUrl: null,
        allowedModels: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .mockRejectedValueOnce(new Error('transaction exploded'));
    appendAuditLogMock.mockResolvedValue({ id: 'audit-1' });

    const { saveAdminConfigSnapshot } = await import('@/lib/server/ai-governance');

    await expect(
      saveAdminConfigSnapshot(orgAdminAuth, {
        policy: {
          allowPersonalOverrides: true,
          allowPersonalCustomBaseUrls: true,
        },
        configs: [
          {
            family: 'llm',
            providerId: 'openai',
            enabled: true,
            allowedModels: ['gpt-4o'],
            defaultModel: 'gpt-4o',
            secret: 'first',
          },
          {
            family: 'image',
            providerId: 'seedream',
            enabled: true,
            secret: 'second',
          },
        ],
      }),
    ).rejects.toThrow('transaction exploded');

    expect(runPostgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(updatePlatformStoreMock).not.toHaveBeenCalled();
  });

  it('uses runPostgresTransaction for personal override snapshots', async () => {
    const fakeExecutor = { unsafe: vi.fn() };
    const savedPolicy = {
      id: 'policy-1',
      organizationId: 'org-1',
      allowPersonalOverrides: true,
      allowPersonalCustomBaseUrls: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const savedOverride = {
      id: 'override-1',
      organizationId: 'org-1',
      userId: 'teacher-1',
      family: 'llm',
      providerId: 'openai',
      encryptedSecret: 'enc:user-secret',
      baseUrl: null,
      preferredModel: 'gpt-4o',
      enabled: true,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    runPostgresTransactionMock.mockImplementation(async (handler) => handler(fakeExecutor));
    findUserProviderOverrideMock.mockResolvedValue(null);
    upsertUserProviderOverrideMock.mockResolvedValue(savedOverride);
    appendAuditLogMock.mockResolvedValue({ id: 'audit-1' });
    findOrganizationAIPolicyMock.mockResolvedValue(savedPolicy);
    listUserProviderOverridesMock.mockResolvedValue([savedOverride]);
    listOrganizationProviderConfigsMock.mockResolvedValue([]);

    const { saveUserOverridesSnapshot } = await import('@/lib/server/ai-governance');
    const snapshot = await saveUserOverridesSnapshot(teacherAuth, {
      overrides: [
        {
          family: 'llm',
          providerId: 'openai',
          enabled: true,
          secret: 'user-secret',
          preferredModel: 'gpt-4o',
        },
      ],
    });

    expect(runPostgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(updatePlatformStoreMock).not.toHaveBeenCalled();
    expect(upsertUserProviderOverrideMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: 'org-1',
        userId: 'teacher-1',
        family: 'llm',
        providerId: 'openai',
        encryptedSecret: 'enc:user-secret',
      }),
      fakeExecutor,
    );
    expect(snapshot.overrides).toHaveLength(1);
  });

  it('does not fall back to JSON writes when an override transaction step throws', async () => {
    const fakeExecutor = { unsafe: vi.fn() };

    runPostgresTransactionMock.mockImplementation(async (handler) => handler(fakeExecutor));
    findUserProviderOverrideMock.mockResolvedValue(null);
    upsertUserProviderOverrideMock
      .mockResolvedValueOnce({
        id: 'override-1',
        organizationId: 'org-1',
        userId: 'teacher-1',
        family: 'llm',
        providerId: 'openai',
        encryptedSecret: 'enc:first',
        baseUrl: null,
        preferredModel: 'gpt-4o',
        enabled: true,
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      .mockRejectedValueOnce(new Error('override transaction exploded'));
    appendAuditLogMock.mockResolvedValue({ id: 'audit-1' });

    const { saveUserOverridesSnapshot } = await import('@/lib/server/ai-governance');

    await expect(
      saveUserOverridesSnapshot(teacherAuth, {
        overrides: [
          {
            family: 'llm',
            providerId: 'openai',
            enabled: true,
            secret: 'first',
            preferredModel: 'gpt-4o',
          },
          {
            family: 'image',
            providerId: 'seedream',
            enabled: true,
            secret: 'second',
          },
        ],
      }),
    ).rejects.toThrow('override transaction exploded');

    expect(runPostgresTransactionMock).toHaveBeenCalledTimes(1);
    expect(updatePlatformStoreMock).not.toHaveBeenCalled();
  });
});
