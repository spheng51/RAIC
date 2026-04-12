import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const resolveModelFromHeadersWithScopeMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const callLLMMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/ai-governance', () => ({
  toGovernedProviderApiErrorResponse: toGovernedProviderApiErrorResponseMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromHeadersWithScope: resolveModelFromHeadersWithScopeMock,
}));

vi.mock('@/lib/ai/llm', () => ({
  callLLM: callLLMMock,
}));

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

describe('POST /api/pbl/chat', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    resolveModelFromHeadersWithScopeMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReset();
    callLLMMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
  });

  it('rejects PBL chat requests that do not have classroom access', async () => {
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

    const { POST } = await import('@/app/api/pbl/chat/route');
    const response = await POST(
      new NextRequest('http://localhost/api/pbl/chat', {
        method: 'POST',
        body: JSON.stringify({
          classroomId: 'room-1',
          message: 'Hello',
          agent: {
            name: 'Question Agent',
            actor_role: 'Coach',
            role_division: 'management',
            system_prompt: 'Help',
            default_mode: 'question',
            delay_time: 0,
            env: {},
            is_user_role: false,
            is_active: true,
            is_system_agent: false,
          },
          currentIssue: null,
          recentMessages: [],
          userRole: 'student',
        }),
      }),
    );

    expect(response.status).toBe(401);
    expect(resolveModelFromHeadersWithScopeMock).not.toHaveBeenCalled();
    expect(callLLMMock).not.toHaveBeenCalled();
  });

  it('passes classroom auth scope into header-based model resolution', async () => {
    const access = {
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    };
    requireClassroomAccessMock.mockResolvedValue(access);
    resolveModelFromHeadersWithScopeMock.mockResolvedValue({
      model: { id: 'mock-model' },
    });
    callLLMMock.mockResolvedValue({ text: 'hello back' });

    const { POST } = await import('@/app/api/pbl/chat/route');
    const request = new NextRequest('http://localhost/api/pbl/chat', {
      method: 'POST',
      body: JSON.stringify({
        classroomId: 'room-1',
        message: 'Hello',
        agent: {
          name: 'Question Agent',
          actor_role: 'Coach',
          role_division: 'management',
          system_prompt: 'Help',
          default_mode: 'question',
          delay_time: 0,
          env: {},
          is_user_role: false,
          is_active: true,
          is_system_agent: false,
        },
        currentIssue: null,
        recentMessages: [],
        userRole: 'student',
      }),
    });

    const response = await POST(request);

    expect(response.status).toBe(200);
    expect(resolveModelFromHeadersWithScopeMock).toHaveBeenCalledWith(request, {
      auth: access.auth,
      organizationId: 'org-1',
      userId: 'teacher-1',
    });
  });

  it('returns a governance 4xx when classroom model resolution is denied', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    });
    resolveModelFromHeadersWithScopeMock.mockRejectedValue(new Error('provider denied'));
    toGovernedProviderApiErrorResponseMock.mockReturnValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'FORBIDDEN',
          error: 'Provider is not approved for this organization',
        },
        { status: 403 },
      ),
    );

    const { POST } = await import('@/app/api/pbl/chat/route');
    const response = await POST(
      new NextRequest('http://localhost/api/pbl/chat', {
        method: 'POST',
        body: JSON.stringify({
          classroomId: 'room-1',
          message: 'Hello',
          agent: {
            name: 'Question Agent',
            actor_role: 'Coach',
            role_division: 'management',
            system_prompt: 'Help',
            default_mode: 'question',
            delay_time: 0,
            env: {},
            is_user_role: false,
            is_active: true,
            is_system_agent: false,
          },
          currentIssue: null,
          recentMessages: [],
          userRole: 'student',
        }),
      }),
    );

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      errorCode: 'FORBIDDEN',
      success: false,
    });
  });
});
