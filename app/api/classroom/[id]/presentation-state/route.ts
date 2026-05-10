import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { createLogger } from '@/lib/logger';
import {
  buildClassroomPresentationStatePayload,
  getClassroomPresentationSnapshot,
} from '@/lib/server/classroom-presentation';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

const log = createLogger('PresentationState API');

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
    if (access.status === 404) {
      log.warn('Presentation classroom access lookup failed', { classroomId: id });
    }
    return access;
  }

  const snapshot = await getClassroomPresentationSnapshot(id);
  if (!snapshot) {
    log.warn('Presentation snapshot lookup failed', { classroomId: id });
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  return apiSuccessWithRequestSession(
    request,
    buildClassroomPresentationStatePayload(snapshot, access.auth.session),
  );
}
