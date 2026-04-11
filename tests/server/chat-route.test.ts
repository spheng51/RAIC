import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const resolveModelMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/resolve-model', () => ({
  resolveModel: resolveModelMock,
}));

vi.mock('@/lib/orchestration/stateless-generate', () => ({
  statelessGenerate: vi.fn(),
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
});
