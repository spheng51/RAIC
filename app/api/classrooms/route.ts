import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { listAccessibleClassroomSummaries } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classrooms API');

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const classrooms = await listAccessibleClassroomSummaries({
      role: auth.session.role,
      userId: auth.user.id,
      organizationId: auth.session.organizationId ?? null,
    });

    return apiSuccessWithRequestSession(request, { classrooms });
  } catch (error) {
    log.error('Failed to list classrooms:', error);
    return apiErrorWithRequestSession(
      request,
      'INTERNAL_ERROR',
      500,
      'Failed to list classrooms',
      error instanceof Error ? error.message : String(error),
    );
  }
}
