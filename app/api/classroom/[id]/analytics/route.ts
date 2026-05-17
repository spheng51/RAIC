import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { buildClassroomLearningAnalytics } from '@/lib/server/classroom-intelligence';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

function canReadTeacherAnalytics(
  access: Exclude<Awaited<ReturnType<typeof requireClassroomAccess>>, NextResponse>,
) {
  return access.source === 'web' && access.auth.session.role !== 'student';
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid classroom id',
    );
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  if (!canReadTeacherAnalytics(access)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Learning analytics are only available for authenticated teacher-managed classrooms',
    );
  }

  const analytics = await buildClassroomLearningAnalytics({
    classroomId: id,
    userId: access.auth.user.id,
  });

  return apiSuccessWithRequestSession(request, { analytics });
}
