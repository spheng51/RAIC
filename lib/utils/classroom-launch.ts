export type ClassroomLaunchMode = 'public-demo' | 'teacher-server';

export interface ClassroomLaunchContext {
  classroomId: string;
  launchMode: ClassroomLaunchMode;
  homePath?: string;
  generationCompletionStatus?: 'complete' | 'partial';
  generationWarnings?: string[];
}

const CLASSROOM_LAUNCH_CONTEXT_KEY = 'classroomLaunchContext';

export function getHomePathForLaunchMode(launchMode: ClassroomLaunchMode): string {
  return launchMode === 'teacher-server' ? '/studio' : '/';
}

export function isTeacherServerLaunchContext(
  context: ClassroomLaunchContext | null,
  classroomId: string,
): boolean {
  return context?.launchMode === 'teacher-server' && context.classroomId === classroomId;
}

export function isPublicDemoLaunchContext(
  context: ClassroomLaunchContext | null,
  classroomId: string,
): boolean {
  return context?.launchMode === 'public-demo' && context.classroomId === classroomId;
}

export function canUseLocalClassroomFallback(input: {
  expectServerBacked: boolean;
  hasLocalStage: boolean;
}): boolean {
  return !input.expectServerBacked && input.hasLocalStage;
}

export function readClassroomLaunchContext(): ClassroomLaunchContext | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const stored = window.sessionStorage.getItem(CLASSROOM_LAUNCH_CONTEXT_KEY);
    if (!stored) {
      return null;
    }

    const parsed = JSON.parse(stored) as Partial<ClassroomLaunchContext>;
    if (
      !parsed ||
      typeof parsed.classroomId !== 'string' ||
      (parsed.launchMode !== 'public-demo' && parsed.launchMode !== 'teacher-server')
    ) {
      return null;
    }

    return {
      classroomId: parsed.classroomId,
      launchMode: parsed.launchMode,
      homePath: typeof parsed.homePath === 'string' ? parsed.homePath : undefined,
      generationCompletionStatus:
        parsed.generationCompletionStatus === 'partial' ? 'partial' : 'complete',
      generationWarnings: Array.isArray(parsed.generationWarnings)
        ? parsed.generationWarnings.filter((value): value is string => typeof value === 'string')
        : undefined,
    };
  } catch {
    return null;
  }
}

export function writeClassroomLaunchContext(context: ClassroomLaunchContext): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.sessionStorage.setItem(CLASSROOM_LAUNCH_CONTEXT_KEY, JSON.stringify(context));
}

export function clearClassroomLaunchContext(classroomId?: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  if (!classroomId) {
    window.sessionStorage.removeItem(CLASSROOM_LAUNCH_CONTEXT_KEY);
    return;
  }

  const existing = readClassroomLaunchContext();
  if (existing?.classroomId === classroomId) {
    window.sessionStorage.removeItem(CLASSROOM_LAUNCH_CONTEXT_KEY);
  }
}
