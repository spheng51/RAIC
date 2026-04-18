import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import {
  noAdaptivePromptExpectation,
  repeatedSessionPromptExpectation,
  scorePromptReplay,
} from '../support/adaptive-runtime-replay';

const requireClassroomAccessMock = vi.fn();
const resolveModelFromHeadersWithScopeMock = vi.fn();
const toGovernedProviderApiErrorResponseMock = vi.fn();
const callLLMMock = vi.fn();
const loadTeacherAdaptivePromptMock = vi.fn();

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

vi.mock('@/lib/server/adaptive-runtime-prompt', () => ({
  loadTeacherAdaptivePrompt: loadTeacherAdaptivePromptMock,
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
    loadTeacherAdaptivePromptMock.mockReset();
    toGovernedProviderApiErrorResponseMock.mockReturnValue(null);
    loadTeacherAdaptivePromptMock.mockResolvedValue('');
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

  it('injects adaptive prompt text for teacher web sessions', async () => {
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
    loadTeacherAdaptivePromptMock.mockResolvedValue(
      [
        '## Adaptive Session Context',
        'This requirement matches 1 prior session(s). Treat this as a repeated-session classroom, not a first-time lesson.',
        '- Last completed segment: Orbital transfer maneuvers',
        '- Revisit intent: remediate',
        '- Mastery hints: transfer windows; burn timing',
        '- Reflection summary: Spend more time on transfer windows before moving on.',
      ].join('\n'),
    );
    callLLMMock.mockResolvedValue({ text: 'hello back' });

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

    expect(response.status).toBe(200);
    expect(loadTeacherAdaptivePromptMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        access,
      }),
    );
    expect(callLLMMock).toHaveBeenCalledTimes(1);

    const llmRequest = callLLMMock.mock.calls[0]?.[0];
    expect(scorePromptReplay(llmRequest?.system, repeatedSessionPromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('fails open for first-run teacher PBL sessions without adaptive prompt state', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'teacher-1' },
        organization: { id: 'org-1' },
        session: { role: 'teacher' },
      },
      source: 'web',
    });
    resolveModelFromHeadersWithScopeMock.mockResolvedValue({
      model: { id: 'mock-model' },
    });
    loadTeacherAdaptivePromptMock.mockResolvedValue('');
    callLLMMock.mockResolvedValue({ text: 'hello back' });

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

    expect(response.status).toBe(200);
    expect(callLLMMock).toHaveBeenCalledTimes(1);

    const llmRequest = callLLMMock.mock.calls[0]?.[0];
    expect(scorePromptReplay(llmRequest?.system, noAdaptivePromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('keeps classroom-cookie access on the non-adaptive PBL path', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        user: { id: 'student-1' },
        organization: { id: 'org-1' },
        session: { role: 'student' },
      },
      source: 'classroom',
    });
    resolveModelFromHeadersWithScopeMock.mockResolvedValue({
      model: { id: 'mock-model' },
    });
    callLLMMock.mockResolvedValue({ text: 'hello back' });

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

    expect(response.status).toBe(200);
    expect(loadTeacherAdaptivePromptMock).toHaveBeenCalled();
    expect(callLLMMock).toHaveBeenCalledTimes(1);

    const llmRequest = callLLMMock.mock.calls[0]?.[0];
    expect(scorePromptReplay(llmRequest?.system, noAdaptivePromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });
});
