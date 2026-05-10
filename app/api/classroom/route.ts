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
  let canonicalClassroomId: string | undefined;
  let sceneCount: number | undefined;
  try {
    const body = await request.json();
    const { stage, scenes } = body;
    stageId = typeof stage?.id === 'string' ? stage.id : undefined;
    sceneCount = Array.isArray(scenes) ? scenes.length : undefined;

    if (!stage || !Array.isArray(scenes)) {
      return apiError(
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required fields: stage, scenes',
      );
    }

    const id = randomUUID();
    canonicalClassroomId = id;
    const baseUrl = buildRequestOrigin(request);

    log.info('Classroom create persist requested', {
      requestedStageId: stageId ?? null,
      canonicalClassroomId: id,
      sceneCount: scenes.length,
      ownerUserId: auth.user.id,
      organizationId: auth.session.organizationId,
    });

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
        requestedStageId: stageId ?? null,
      },
    });

    return apiSuccessWithRequestSession(request, { id: persisted.id, url: persisted.url }, 201);
  } catch (error) {
    log.error(
      `Classroom storage failed [stageId=${stageId ?? 'unknown'}, canonicalId=${
        canonicalClassroomId ?? 'unknown'
      }, scenes=${sceneCount ?? 0}]:`,
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
      log.warn('Classroom GET read miss after access check', { classroomId: id });
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
