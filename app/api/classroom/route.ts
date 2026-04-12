import { type NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiSuccessWithRequestSession,
  apiError,
  apiErrorWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { recordAuditEvent } from '@/lib/server/audit-log';
import {
  buildRequestOrigin,
  isValidClassroomId,
  persistClassroom,
  readClassroom,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('Classroom API');

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  let stageId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = stage?.id;
    sceneCount = scenes?.length;

    if (!stage || !scenes) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const requestedId = stage.id;
    if (requestedId !== undefined && requestedId !== null && requestedId !== '') {
      if (typeof requestedId !== 'string' || !isValidClassroomId(requestedId)) {
        return apiErrorWithRequestSession(
          request,
          API_ERROR_CODES.INVALID_REQUEST,
          400,
          'Invalid classroom id',
        );
      }
    }

    const id = requestedId || randomUUID();
    const baseUrl = buildRequestOrigin(request);

    const persisted = await persistClassroom(
      {
        id,
        ownerUserId: auth.user.id,
        organizationId: auth.session.organizationId,
        stage: { ...stage, id },
        scenes,
      },
      baseUrl,
    );

    await recordAuditEvent({
      organizationId: auth.session.organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'classroom.created',
      resourceType: 'classroom',
      resourceId: persisted.id,
      metadata: {
        source: 'web',
        classroomId: persisted.id,
      },
    });

    return apiSuccessWithRequestSession(request, { id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, scenes=${sceneCount ?? 0}]:`,
      error,
    );
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to store classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');

    if (!id) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required parameter: id',
      );
    }

    if (!isValidClassroomId(id)) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
    }

    const access = await requireClassroomAccess(request, id);
    if (access instanceof NextResponse) {
      return access;
    }

    const classroom = await readClassroom(id);
    if (!classroom) {
      return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
    }

    return apiSuccessWithRequestSession(request, { classroom });
  } catch (error) {
    log.error(
      `Classroom retrieval failed [id=${request.nextUrl.searchParams.get('id') ?? 'unknown'}]:`,
      error,
    );
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to retrieve classroom',
      error instanceof Error ? error.message : String(error),
    );
  }
}
