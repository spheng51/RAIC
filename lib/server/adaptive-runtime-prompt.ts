import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess, type ClassroomAccessContext } from '@/lib/auth/classroom-access';
import {
  buildAdaptiveRuntimeContext,
  formatAdaptiveContextForPrompt,
} from '@/lib/server/classroom-intelligence';

function isTeacherWebAccess(access: ClassroomAccessContext): boolean {
  return access.source === 'web' && access.auth.session.role === 'teacher';
}

export async function loadTeacherAdaptivePrompt(input: {
  classroomId?: string | null;
  request?: NextRequest;
  access?: ClassroomAccessContext;
  onError?: (error: unknown) => void;
}): Promise<string> {
  const classroomId = input.classroomId?.trim();
  if (!classroomId) {
    return '';
  }

  let access = input.access;
  if (!access && input.request) {
    const resolvedAccess = await requireClassroomAccess(input.request, classroomId);
    if (!(resolvedAccess instanceof NextResponse)) {
      access = resolvedAccess;
    }
  }

  if (!access || !isTeacherWebAccess(access)) {
    return '';
  }

  try {
    const adaptiveContext = await buildAdaptiveRuntimeContext({
      classroomId,
      userId: access.auth.user.id,
    });
    return formatAdaptiveContextForPrompt(adaptiveContext);
  } catch (error) {
    input.onError?.(error);
    return '';
  }
}
