import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireRequestRoleMock = vi.fn();
const encryptSecretMock = vi.fn((value: string) => `enc:${value}`);

type PlatformStore = {
  users: unknown[];
  organizations: unknown[];
  memberships: unknown[];
  sessions: unknown[];
  joinTokens: unknown[];
  auditLogs: Array<{ action: string }>;
  organizationAiPolicies: unknown[];
  organizationProviderConfigs: unknown[];
  userProviderOverrides: unknown[];
};

let platformStore: PlatformStore;

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/encrypted-secrets', () => ({
  encryptSecret: encryptSecretMock,
  decryptSecret: vi.fn((value: string) => value),
  hasEncryptionKeyConfigured: vi.fn(() => true),
}));

vi.mock('@/lib/db/client', () => ({
  runPostgresQuery: vi.fn(async () => null),
  runPostgresTransaction: vi.fn(async () => null),
  updatePlatformStore: vi.fn(
    async (updater: (store: PlatformStore) => Promise<unknown> | unknown) => {
      const nextStore = structuredClone(platformStore);
      const result = await updater(nextStore);
      platformStore = nextStore;
      return result;
    },
  ),
  readPlatformStore: vi.fn(async () => structuredClone(platformStore)),
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const authContext = {
  user: { id: 'admin-1' },
  session: { role: 'org_admin' },
  organization: { id: 'org-1' },
} as never;

describe('PUT /api/admin/ai/config', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    encryptSecretMock.mockReset();
    encryptSecretMock.mockImplementation((value: string) => `enc:${value}`);
    requireRequestRoleMock.mockResolvedValue(authContext);
    platformStore = {
      users: [],
      organizations: [],
      memberships: [],
      sessions: [],
      joinTokens: [],
      auditLogs: [],
      organizationAiPolicies: [],
      organizationProviderConfigs: [],
      userProviderOverrides: [],
    };
  });

  it('returns 400 for malformed payloads', async () => {
    const { PUT } = await import('@/app/api/admin/ai/config/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/admin/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
          policy: {
            allowPersonalOverrides: 'yes',
            allowPersonalCustomBaseUrls: false,
          },
          configs: [],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errorCode).toBe('INVALID_REQUEST');
  });

  it('does not persist a partial snapshot when a later config fails mid-save', async () => {
    encryptSecretMock.mockReturnValueOnce('enc:first').mockImplementationOnce(() => {
      throw new Error('encryption exploded');
    });

    const { PUT } = await import('@/app/api/admin/ai/config/route');
    const { readPlatformStore } = await import('@/lib/db/client');

    const response = await PUT(
      new NextRequest('http://localhost/api/admin/ai/config', {
        method: 'PUT',
        body: JSON.stringify({
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
              secret: 'first-secret',
            },
            {
              family: 'image',
              providerId: 'seedream',
              enabled: true,
              secret: 'second-secret',
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(500);

    const store = await readPlatformStore();
    expect(store.organizationAiPolicies).toEqual([]);
    expect(store.organizationProviderConfigs).toEqual([]);
    expect(store.auditLogs).toEqual([]);
  });
});
