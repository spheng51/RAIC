import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { ClassroomAccessContext } from '@/lib/auth/classroom-access';
import { repeatedSessionAdaptiveContext } from '../support/adaptive-runtime-replay';

const requireClassroomAccessMock = vi.fn();
const buildAdaptiveRuntimeContextMock = vi.fn();
const formatAdaptiveContextForPromptMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-intelligence', () => ({
  buildAdaptiveRuntimeContext: buildAdaptiveRuntimeContextMock,
  formatAdaptiveContextForPrompt: formatAdaptiveContextForPromptMock,
}));

function buildAccess(input: {
  source: 'web' | 'classroom';
  role: 'teacher' | 'student' | 'org_admin' | 'system_admin';
  userId?: string;
}): ClassroomAccessContext {
  return {
    source: input.source,
    auth: {
      user: { id: input.userId ?? `${input.role}-1` },
      organization: { id: 'org-1' },
      session: {
        role: input.role,
        kind: input.source === 'classroom' ? 'classroom' : 'web',
        classroomId: input.source === 'classroom' ? 'room-1' : undefined,
      },
    },
    classroom: {
      id: 'room-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      stage: { id: 'room-1', name: 'Physics', language: 'en-US' },
      scenes: [],
    },
  } as unknown as ClassroomAccessContext;
}

describe('adaptive runtime prompt readiness gates', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    requireClassroomAccessMock.mockReset();
    buildAdaptiveRuntimeContextMock.mockReset();
    formatAdaptiveContextForPromptMock.mockReset();

    buildAdaptiveRuntimeContextMock.mockResolvedValue(repeatedSessionAdaptiveContext);
    formatAdaptiveContextForPromptMock.mockReturnValue('## Adaptive Session Context');
  });

  it('keeps the student adaptation beta flag disabled by default', async () => {
    const { isStudentAdaptationBetaEnabled } = await import('@/lib/server/student-adaptation-beta');

    expect(isStudentAdaptationBetaEnabled({})).toBe(false);
    expect(isStudentAdaptationBetaEnabled({ RAIC_STUDENT_ADAPTATION_BETA: 'false' })).toBe(false);
    expect(isStudentAdaptationBetaEnabled({ RAIC_STUDENT_ADAPTATION_BETA: 'true' })).toBe(true);
    expect(isStudentAdaptationBetaEnabled({ RAIC_STUDENT_ADAPTATION_BETA: '1' })).toBe(true);
  });

  it('requires both the readiness flag and explicit future consent for student adaptive context', async () => {
    const { shouldLoadAdaptiveRuntimeContext } =
      await import('@/lib/server/student-adaptation-beta');
    const studentAccess = buildAccess({ source: 'web', role: 'student', userId: 'student-1' });

    expect(
      shouldLoadAdaptiveRuntimeContext({
        access: studentAccess,
        env: { RAIC_STUDENT_ADAPTATION_BETA: 'true' },
      }),
    ).toBe(false);
    expect(
      shouldLoadAdaptiveRuntimeContext({
        access: studentAccess,
        studentConsent: true,
        env: { RAIC_STUDENT_ADAPTATION_BETA: 'false' },
      }),
    ).toBe(false);
    expect(
      shouldLoadAdaptiveRuntimeContext({
        access: studentAccess,
        studentConsent: true,
        env: { RAIC_STUDENT_ADAPTATION_BETA: 'true' },
      }),
    ).toBe(true);
  });

  it('still loads adaptive prompts for authenticated teacher web access', async () => {
    const { loadTeacherAdaptivePrompt } = await import('@/lib/server/adaptive-runtime-prompt');

    const prompt = await loadTeacherAdaptivePrompt({
      classroomId: 'room-1',
      access: buildAccess({ source: 'web', role: 'teacher', userId: 'teacher-1' }),
    });

    expect(prompt).toBe('## Adaptive Session Context');
    expect(buildAdaptiveRuntimeContextMock).toHaveBeenCalledWith({
      classroomId: 'room-1',
      userId: 'teacher-1',
    });
  });

  it('does not treat the readiness flag alone as classroom-cookie student consent', async () => {
    vi.stubEnv('RAIC_STUDENT_ADAPTATION_BETA', 'true');
    const { loadTeacherAdaptivePrompt } = await import('@/lib/server/adaptive-runtime-prompt');

    const prompt = await loadTeacherAdaptivePrompt({
      classroomId: 'room-1',
      access: buildAccess({ source: 'classroom', role: 'student', userId: 'student-1' }),
    });

    expect(prompt).toBe('');
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();
    expect(formatAdaptiveContextForPromptMock).not.toHaveBeenCalled();
  });

  it('keeps student web access on the non-adaptive path without reviewed consent', async () => {
    vi.stubEnv('RAIC_STUDENT_ADAPTATION_BETA', 'true');
    const { loadTeacherAdaptivePrompt } = await import('@/lib/server/adaptive-runtime-prompt');

    const prompt = await loadTeacherAdaptivePrompt({
      classroomId: 'room-1',
      access: buildAccess({ source: 'web', role: 'student', userId: 'student-1' }),
    });

    expect(prompt).toBe('');
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();
  });

  it('fails closed to an empty prompt when request-derived access is denied', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json(
        { success: false, errorCode: 'UNAUTHORIZED', error: 'Classroom access required' },
        { status: 401 },
      ),
    );
    const { loadTeacherAdaptivePrompt } = await import('@/lib/server/adaptive-runtime-prompt');

    const prompt = await loadTeacherAdaptivePrompt({
      classroomId: 'room-1',
      request: new NextRequest('http://localhost/classroom/room-1'),
    });

    expect(prompt).toBe('');
    expect(buildAdaptiveRuntimeContextMock).not.toHaveBeenCalled();
  });
});
