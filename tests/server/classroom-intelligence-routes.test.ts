import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const buildClassroomLearningAnalyticsMock = vi.fn();
const createClassroomReflectionMock = vi.fn();
const getClassroomSessionContextMock = vi.fn();
const listClassroomReflectionsMock = vi.fn();
const upsertClassroomSessionContextMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-intelligence', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-intelligence')>();
  return {
    ...actual,
    buildClassroomLearningAnalytics: buildClassroomLearningAnalyticsMock,
    createClassroomReflection: createClassroomReflectionMock,
    getClassroomSessionContext: getClassroomSessionContextMock,
    listClassroomReflections: listClassroomReflectionsMock,
    upsertClassroomSessionContext: upsertClassroomSessionContextMock,
  };
});

function buildWebAccess(overrides: Record<string, unknown> = {}) {
  return {
    auth: {
      session: { role: 'teacher', kind: 'web', organizationId: 'org-1' },
      user: { id: 'teacher-1' },
    },
    source: 'web',
    classroom: {
      id: 'room-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      stage: {
        id: 'room-1',
        name: 'Orbital Mechanics',
        language: 'en-US',
      },
      scenes: [
        { id: 'scene-1', order: 1 },
        { id: 'scene-2', order: 2 },
        { id: 'scene-3', order: 3 },
      ],
      createdAt: '2026-04-17T00:00:00.000Z',
    },
    ...overrides,
  };
}

describe('classroom intelligence routes', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    buildClassroomLearningAnalyticsMock.mockReset();
    createClassroomReflectionMock.mockReset();
    getClassroomSessionContextMock.mockReset();
    listClassroomReflectionsMock.mockReset();
    upsertClassroomSessionContextMock.mockReset();

    requireClassroomAccessMock.mockResolvedValue(buildWebAccess());
    getClassroomSessionContextMock.mockResolvedValue({
      id: 'ctx-1',
      classroomId: 'room-1',
      userId: 'teacher-1',
    });
    listClassroomReflectionsMock.mockResolvedValue([]);
    upsertClassroomSessionContextMock.mockResolvedValue({
      id: 'ctx-1',
      classroomId: 'room-1',
      userId: 'teacher-1',
      completedSceneCount: 2,
      totalSceneCount: 3,
      masteryHints: ['vector decomposition'],
      revisitIntent: 'revisit',
    });
    createClassroomReflectionMock.mockResolvedValue({
      id: 'reflection-1',
      classroomId: 'room-1',
      userId: 'teacher-1',
      summary: 'Needs more vector practice',
      challengingAreas: ['vector decomposition'],
      confidenceScore: 2,
      revisitIntent: 'remediate',
      createdAt: '2026-04-17T00:00:00.000Z',
    });
    buildClassroomLearningAnalyticsMock.mockResolvedValue({
      classroomId: 'room-1',
      generatedAt: '2026-04-17T00:00:00.000Z',
      source: 'teacher-internal',
      progress: {
        completedSceneCount: 2,
        totalSceneCount: 3,
        completionRatio: 0.67,
        pacingPreference: 'balance',
      },
      reflections: {
        count: 1,
        averageConfidenceScore: 2,
        revisitIntentCounts: {
          continue: 0,
          revisit: 0,
          remediate: 1,
          deepen: 0,
        },
        topChallengingAreas: ['vector decomposition'],
      },
      qualitySignals: {
        qualityBand: 'watch',
        needsAttention: true,
        suggestedFocus: ['vector decomposition'],
      },
      retention: {
        derivedOnly: true,
        sourceRecords: ['classroom_session_contexts', 'classroom_reflections'],
      },
    });
  });

  it('rejects classroom-cookie access for session context writes', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      buildWebAccess({
        source: 'classroom',
        auth: {
          session: { role: 'student', kind: 'classroom', classroomId: 'room-1' },
          user: { id: 'student-1' },
        },
      }),
    );

    const { POST } = await import('@/app/api/classroom/[id]/session-context/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/session-context', {
        method: 'POST',
        body: JSON.stringify({ completedSceneCount: 1 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(upsertClassroomSessionContextMock).not.toHaveBeenCalled();
  });

  it('validates session-context counts and normalizes the payload', async () => {
    const { POST } = await import('@/app/api/classroom/[id]/session-context/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/session-context', {
        method: 'POST',
        body: JSON.stringify({
          completedSceneCount: 2,
          totalSceneCount: 3,
          masteryHints: [' vector decomposition ', 'vector decomposition', '', 'transfer tasks'],
          revisitIntent: 'revisit',
          lastCompletedSceneId: 'scene-2',
          lastCompletedSceneTitle: 'Force vectors in orbit',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(upsertClassroomSessionContextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        completedSceneCount: 2,
        totalSceneCount: 3,
        masteryHints: ['vector decomposition', 'transfer tasks'],
        revisitIntent: 'revisit',
      }),
    );
  });

  it('rejects invalid session-context bodies', async () => {
    const { POST } = await import('@/app/api/classroom/[id]/session-context/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/session-context', {
        method: 'POST',
        body: JSON.stringify({
          completedSceneCount: 4,
          totalSceneCount: 3,
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('INVALID_REQUEST');
    expect(body.error).toContain('cannot exceed');
  });

  it('hydrates reflection GET responses for the current teacher only', async () => {
    listClassroomReflectionsMock.mockResolvedValue([
      {
        id: 'reflection-1',
        classroomId: 'room-1',
        userId: 'teacher-1',
      },
    ]);

    const { GET } = await import('@/app/api/classroom/[id]/reflection/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/reflection'),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.reflections).toHaveLength(1);
    expect(listClassroomReflectionsMock).toHaveBeenCalledWith({
      classroomId: 'room-1',
      userId: 'teacher-1',
      limit: 5,
    });
  });

  it('validates reflection payloads before persisting', async () => {
    const { POST } = await import('@/app/api/classroom/[id]/reflection/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/reflection', {
        method: 'POST',
        body: JSON.stringify({
          summary: '   ',
          confidenceScore: 7,
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.errorCode).toBe('INVALID_REQUEST');
    expect(createClassroomReflectionMock).not.toHaveBeenCalled();
  });

  it('persists normalized reflection data for teacher-managed classrooms', async () => {
    const { POST } = await import('@/app/api/classroom/[id]/reflection/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/reflection', {
        method: 'POST',
        body: JSON.stringify({
          summary: ' Needs more vector practice before transfer tasks. ',
          challengingAreas: [' vector decomposition ', 'vector decomposition', 'transfer tasks'],
          confidenceScore: 2,
          revisitIntent: 'remediate',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(201);
    expect(createClassroomReflectionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        summary: 'Needs more vector practice before transfer tasks.',
        challengingAreas: ['vector decomposition', 'transfer tasks'],
        confidenceScore: 2,
        revisitIntent: 'remediate',
      }),
    );
  });

  it('rejects student web reflections', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      buildWebAccess({
        auth: {
          session: { role: 'student', kind: 'web', organizationId: 'org-1' },
          user: { id: 'student-1' },
        },
      }),
    );

    const { POST } = await import('@/app/api/classroom/[id]/reflection/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/reflection', {
        method: 'POST',
        body: JSON.stringify({ summary: 'Should fail' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(createClassroomReflectionMock).not.toHaveBeenCalled();
  });

  it('returns teacher-only aggregate learning analytics', async () => {
    const { GET } = await import('@/app/api/classroom/[id]/analytics/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/analytics'), {
      params: Promise.resolve({ id: 'room-1' }),
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.analytics).toMatchObject({
      classroomId: 'room-1',
      source: 'teacher-internal',
      qualitySignals: {
        qualityBand: 'watch',
        needsAttention: true,
      },
      retention: {
        derivedOnly: true,
      },
    });
    expect(buildClassroomLearningAnalyticsMock).toHaveBeenCalledWith({
      classroomId: 'room-1',
      userId: 'teacher-1',
    });
  });

  it('rejects student access to teacher learning analytics', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      buildWebAccess({
        auth: {
          session: { role: 'student', kind: 'web', organizationId: 'org-1' },
          user: { id: 'student-1' },
        },
      }),
    );

    const { GET } = await import('@/app/api/classroom/[id]/analytics/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/analytics'), {
      params: Promise.resolve({ id: 'room-1' }),
    });

    expect(response.status).toBe(403);
    expect(buildClassroomLearningAnalyticsMock).not.toHaveBeenCalled();
  });

  it('passes through classroom-access denials unchanged', async () => {
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

    const { GET } = await import('@/app/api/classroom/[id]/session-context/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/session-context'),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(401);
  });
});
