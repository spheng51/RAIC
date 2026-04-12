import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  buildClassroomCollaborationStatePayload,
  getClassroomCollaborationSnapshot,
} from '@/lib/server/classroom-collaboration';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const snapshot = await getClassroomCollaborationSnapshot(id);
  if (!snapshot) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  return apiSuccessWithRequestSession(
    request,
    buildClassroomCollaborationStatePayload(snapshot, access.auth.session),
  );
}
