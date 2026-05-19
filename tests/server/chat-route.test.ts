import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  repeatedSessionAdaptiveContext,
  scoreAdaptiveContextReplay,
} from '../support/adaptive-runtime-replay';

const requireClassroomAccessMock = vi.fn();
const resolveModelMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const statelessGenerateMock = vi.fn();
const buildAdaptiveRuntimeContextMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: resolveModelMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
}));

vi.mock('@/lib/server/classroom-intelligence', () => ({
  buildAdaptiveRuntimeContext: buildAdaptiveRuntimeContextMock,
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
    vi.unstubAllEnvs();
    requireClassroomAccessMock.mockReset();
    resolveModelMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReset();
    statelessGenerateMock.mockReset();
    buildAdaptiveRuntimeContextMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
    buildAdaptiveRuntimeContextMock.mockResolvedValue(null);
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

  it('keeps explicit teacher-server chat behind classroom access', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'INVALID_REQUEST',
          error: 'Classroom not found',
        },
        { status: 404 },
      ),
    );

    const { POST } = await import('@/app/api/chat/route');
    const response = await POST(
      new NextRequest('http://localhost/api/chat', {
        method: 'POST',
        body: JSON.stringify({
          messages: [{ id: 'msg-1', role: 'user', parts: [] }],
          storeState: {
            stage: { id: 'missing-room' },
            scenes: [],
            currentSceneId: null,
            mode: 'playback',
            whiteboardOpen: false,
          },
          classroomSource: 'teacher-server',
          config: {
            agentIds: ['agent-1'],
          },
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(requireClassroomAccessMock).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'missing-room',
    );
    expect(resolveModelMock).not.toHaveBeenCalled();
  });

  it('allows public-demo chat without server classroom access or adaptive context', async () => {
    resolveModelMock.mockResolvedValue({
      model: { id: 'mock-model' },
      modelInfo: undefined,
      modelString: 'openai:gpt-4o',
      providerId: 'openai',
      apiKey: 'client-key',
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
            stage: { id: 'local-room' },
            scenes: [],
            currentSceneId: null,
            mode: 'playback',
            whiteboardOpen: false,
          },
          classroomSource: 'public-demo',
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
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();
    expect(resolveModelMock).toHaveBeenCalledWith({
      modelString: 'openai:gpt-4o',
      apiKey: 'client-key',
      baseUrl: 'https://example.com/v1',
      providerType: 'openai',
      auth: null,
      organizationId: null,
      userId: null,
    });
    expect(statelessGenerateMock).toHaveBeenCalledTimes(1);
    expect(statelessGenerateMock.mock.calls[0]?.[0]).toMatchObject({
      adaptiveContext: null,
      classroomSource: 'public-demo',
    });
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
          classroomSource: 'teacher-server',
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

  it('injects adaptive runtime context only for teacher web sessions', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    });
    resolveModelMock.mockResolvedValue({
      model: { id: 'mock-model' },
      modelInfo: undefined,
      modelString: 'openai:gpt-4o',
      providerId: 'openai',
      apiKey: 'resolved-key',
    });
    buildAdaptiveRuntimeContextMock.mockResolvedValue(repeatedSessionAdaptiveContext);
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
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(buildAdaptiveRuntimeContextMock).toHaveBeenCalledWith({
      classroomId: 'room-1',
      userId: 'teacher-1',
    });
    expect(statelessGenerateMock).toHaveBeenCalledTimes(1);

    const generationRequest = statelessGenerateMock.mock.calls[0]?.[0];
    expect(scoreAdaptiveContextReplay(generationRequest?.adaptiveContext, 'present')).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('fails open for first-run teacher web sessions with no saved adaptive context', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    });
    resolveModelMock.mockResolvedValue({
      model: { id: 'mock-model' },
      modelInfo: undefined,
      modelString: 'openai:gpt-4o',
      providerId: 'openai',
      apiKey: 'resolved-key',
    });
    buildAdaptiveRuntimeContextMock.mockResolvedValue(null);
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
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(statelessGenerateMock).toHaveBeenCalledTimes(1);

    const generationRequest = statelessGenerateMock.mock.calls[0]?.[0];
    expect(scoreAdaptiveContextReplay(generationRequest?.adaptiveContext, 'absent')).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('keeps classroom-cookie flows on the current non-adaptive path', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'student-1' },
        organization: { id: 'org-1' },
        session: { role: 'student' },
      },
      source: 'classroom',
    });
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
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();
    expect(statelessGenerateMock).toHaveBeenCalledTimes(1);

    const generationRequest = statelessGenerateMock.mock.calls[0]?.[0];
    expect(scoreAdaptiveContextReplay(generationRequest?.adaptiveContext, 'absent')).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('keeps signed-in student web sessions non-adaptive without reviewed consent', async () => {
    vi.stubEnv('RAIC_STUDENT_ADAPTATION_BETA', 'true');
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'student-1' },
        organization: { id: 'org-1' },
        session: { role: 'student' },
      },
      source: 'web',
    });
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
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();

    const generationRequest = statelessGenerateMock.mock.calls[0]?.[0];
    expect(scoreAdaptiveContextReplay(generationRequest?.adaptiveContext, 'absent')).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('does not treat the student beta flag alone as adaptive runtime consent', async () => {
    vi.stubEnv('RAIC_STUDENT_ADAPTATION_BETA', 'true');
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'student-1' },
        organization: { id: 'org-1' },
        session: { role: 'student' },
      },
      source: 'classroom',
    });
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
          apiKey: '',
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();

    const generationRequest = statelessGenerateMock.mock.calls[0]?.[0];
    expect(scoreAdaptiveContextReplay(generationRequest?.adaptiveContext, 'absent')).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });
});
