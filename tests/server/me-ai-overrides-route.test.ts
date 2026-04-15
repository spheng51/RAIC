import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const encryptSecretMock = vi.fn((value: string) => `enc:${value}`);

type PlatformStore = {
  users: unknown[];
  organizations: unknown[];
  memberships: unknown[];
  sessions: unknown[];
  joinTokens: unknown[];
  auditLogs: Array<{ action: string }>;
  organizationAiPolicies: Array<{
    id: string;
    organizationId: string;
    allowPersonalOverrides: boolean;
    allowPersonalCustomBaseUrls: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
  organizationProviderConfigs: Array<{
    id: string;
    organizationId: string;
    family: string;
    providerId: string;
    providerDefinition: null;
    encryptedSecret: string | null;
    baseUrl: string | null;
    allowedModels: string[];
    defaultModel: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
  }>;
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
  user: { id: 'teacher-1', googleSub: 'google-sub-1' },
  session: { role: 'teacher', kind: 'web' },
  organization: { id: 'org-1' },
} as const;

async function seedApprovedProviders() {
  const { updatePlatformStore } = await import('@/lib/db/client');

  await updatePlatformStore((store) => {
    store.organizationAiPolicies.push({
      id: 'policy-1',
      organizationId: 'org-1',
      allowPersonalOverrides: true,
      allowPersonalCustomBaseUrls: true,
      createdAt: '2026-04-12T00:00:00.000Z',
      updatedAt: '2026-04-12T00:00:00.000Z',
    });
    store.organizationProviderConfigs.push(
      {
        id: 'config-1',
        organizationId: 'org-1',
        family: 'llm',
        providerId: 'openai',
        providerDefinition: null,
        encryptedSecret: 'org-secret',
        baseUrl: null,
        allowedModels: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        enabled: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
      {
        id: 'config-2',
        organizationId: 'org-1',
        family: 'image',
        providerId: 'seedream',
        providerDefinition: null,
        encryptedSecret: 'image-secret',
        baseUrl: null,
        allowedModels: [],
        defaultModel: null,
        enabled: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      },
    );
  });
}

describe('PUT /api/me/ai/overrides', () => {
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
    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'openai',
              enabled: 'yes',
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errorCode).toBe('INVALID_REQUEST');
  });

  it('returns a clear auth error when the user is signed out', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        { status: 401 },
      ),
    );

    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'grok',
              enabled: true,
              secret: 'grok-key',
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(401);
    expect(json.errorCode).toBe('UNAUTHORIZED');
    expect(json.error).toContain('Sign in with Google on a web session');
  });

  it('returns 403 for non-web sessions', async () => {
    requireRequestRoleMock.mockResolvedValue({
      ...authContext,
      session: {
        ...authContext.session,
        kind: 'classroom',
      },
    });

    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'grok',
              enabled: true,
              secret: 'grok-key',
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.errorCode).toBe('FORBIDDEN');
    expect(json.error).toContain('Sign in with Google on a web session');
  });

  it('returns 403 when the user does not have a Google-backed identity', async () => {
    requireRequestRoleMock.mockResolvedValue({
      ...authContext,
      user: {
        ...authContext.user,
        googleSub: null,
      },
    });

    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'grok',
              enabled: true,
              secret: 'grok-key',
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.errorCode).toBe('FORBIDDEN');
    expect(json.error).toContain('Sign in with Google on a web session');
  });

  it('allows first-time built-in provider saves without org approval', async () => {
    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const { readPlatformStore, updatePlatformStore } = await import('@/lib/db/client');

    await updatePlatformStore((store) => {
      store.organizationAiPolicies.push({
        id: 'policy-1',
        organizationId: 'org-1',
        allowPersonalOverrides: false,
        allowPersonalCustomBaseUrls: false,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      });
    });

    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'grok',
              enabled: true,
              secret: 'grok-key',
              baseUrl: 'https://api.x.ai/v1',
              preferredModel: 'grok-4.20-reasoning',
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(200);

    const store = await readPlatformStore();
    expect(store.userProviderOverrides).toHaveLength(1);
    expect(store.userProviderOverrides[0]).toMatchObject({
      organizationId: 'org-1',
      userId: 'teacher-1',
      family: 'llm',
      providerId: 'grok',
      encryptedSecret: 'enc:grok-key',
      baseUrl: 'https://api.x.ai/v1',
      preferredModel: 'grok-4.20-reasoning',
      enabled: true,
    });
  });

  it('returns 403 when personal overrides are disabled', async () => {
    const { updatePlatformStore } = await import('@/lib/db/client');
    await updatePlatformStore((store) => {
      store.organizationAiPolicies.push({
        id: 'policy-1',
        organizationId: 'org-1',
        allowPersonalOverrides: false,
        allowPersonalCustomBaseUrls: false,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      });
      store.organizationProviderConfigs.push({
        id: 'config-1',
        organizationId: 'org-1',
        family: 'llm',
        providerId: 'openai',
        providerDefinition: null,
        encryptedSecret: 'org-secret',
        baseUrl: null,
        allowedModels: ['gpt-4o'],
        defaultModel: 'gpt-4o',
        enabled: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      });
    });

    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'openai',
              enabled: true,
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(403);
    expect(json.errorCode).toBe('FORBIDDEN');
  });

  it('keeps custom providers on the org-approval path', async () => {
    const { updatePlatformStore } = await import('@/lib/db/client');
    await updatePlatformStore((store) => {
      store.organizationAiPolicies.push({
        id: 'policy-1',
        organizationId: 'org-1',
        allowPersonalOverrides: true,
        allowPersonalCustomBaseUrls: true,
        createdAt: '2026-04-12T00:00:00.000Z',
        updatedAt: '2026-04-12T00:00:00.000Z',
      });
    });

    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'custom-llm',
              enabled: true,
              secret: 'custom-key',
            },
          ],
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.errorCode).toBe('INVALID_REQUEST');
    expect(json.error).toContain('not approved');
  });

  it('does not persist a partial override batch when a later save fails', async () => {
    await seedApprovedProviders();
    encryptSecretMock.mockReturnValueOnce('enc:first').mockImplementationOnce(() => {
      throw new Error('override encryption exploded');
    });

    const { PUT } = await import('@/app/api/me/ai/overrides/route');
    const { readPlatformStore } = await import('@/lib/db/client');

    const response = await PUT(
      new NextRequest('http://localhost/api/me/ai/overrides', {
        method: 'PUT',
        body: JSON.stringify({
          overrides: [
            {
              family: 'llm',
              providerId: 'openai',
              enabled: true,
              secret: 'first-override',
              preferredModel: 'gpt-4o',
            },
            {
              family: 'image',
              providerId: 'seedream',
              enabled: true,
              secret: 'second-override',
            },
          ],
        }),
      }),
    );

    expect(response.status).toBe(500);

    const store = await readPlatformStore();
    expect(store.userProviderOverrides).toEqual([]);
    expect(
      store.auditLogs.filter((entry) => entry.action === 'user_provider_override.updated'),
    ).toEqual([]);
  });
});
