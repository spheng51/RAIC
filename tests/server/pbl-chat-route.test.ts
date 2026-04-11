import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const resolveModelFromHeadersMock = vi.fn();
const callLLMMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModelFromHeaders: resolveModelFromHeadersMock,
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
    resolveModelFromHeadersMock.mockReset();
    callLLMMock.mockReset();
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
    expect(resolveModelFromHeadersMock).not.toHaveBeenCalled();
    expect(callLLMMock).not.toHaveBeenCalled();
  });
});
