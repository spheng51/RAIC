import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const resolveModelMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const statelessGenerateMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: resolveModelMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
}));

vi.mock('@/lib/orchestration/stateless-generate', () => ({
  statelessGenerate: statelessGenerateMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('POST /api/chat', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    resolveModelMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReset();
    statelessGenerateMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
  });

  it('rejects classroom chat requests that do not have classroom access', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Classroom access required',
        },
        { status: 401 },
      ),
    );

    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(
      new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ id: 'msg-1', role: 'user', parts: [] }],
          storeState: {
            stage: { id: 'room-1' },
            scenes: [],
            currentSceneId: null,
            mode: 'playback',
            whiteboardOpen: false,
          },
          config: {
            agentIds: ['agent-1'],
          },
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it('returns a governance 4xx when model resolution is denied by policy', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    });
    resolveModelMock.mockRejectedValue(new Error('provider denied'));
    toGovernedProviderApiErrorResponseMock.mockReturnValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'PROVIDER_NOT_APPROVED',
          error: 'Provider is not approved for this organization',
        },
        { status: 403 },
      ),
    );

    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(
      new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ id: 'msg-1', role: 'user', parts: [] }],
          storeState: {
            stage: { id: 'room-1' },
            scenes: [],
            currentSceneId: null,
            mode: 'playback',
            whiteboardOpen: false,
          },
          config: {
            agentIds: ['agent-1'],
          },
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'PROVIDER_NOT_APPROVED',
      success: false,
    });
  });

  it('passes classroom auth scope into model resolution', async () => {
    const access = {
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    };
    requireClassroomAccessMock.mockResolvedValue(access);
    resolveModelMock.mockResolvedValue({
      model: { id: 'mock-model' },
      modelInfo: undefined,
      modelString: 'openai:gpt-4o',
      providerId: 'openai',
      apiKey: 'resolved-key',
    });
    statelessGenerateMock.mockReturnValue(
      (async function* () {
        return;
      })(),
    );

    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(
      new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ id: 'msg-1', role: 'user', parts: [] }],
          storeState: {
            stage: { id: 'room-1' },
            scenes: [],
            currentSceneId: null,
            mode: 'playback',
            whiteboardOpen: false,
          },
          config: {
            agentIds: ['agent-1'],
          },
          apiKey: 'client-key',
          baseUrl: 'https://example.com/v1',
          providerType: 'openai',
          model: 'openai:gpt-4o',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveModelMock).toHaveBeenCalledWith({
      modelString: 'openai:gpt-4o',
      apiKey: 'client-key',
      baseUrl: 'https://example.com/v1',
      providerType: 'openai',
      auth: access.auth,
      organizationId: 'org-1',
      userId: 'teacher-1',
    });
  });
});
