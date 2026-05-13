import { type NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  createScheduledClassForAccess,
  deleteScheduledClassForAccess,
  listScheduledClassesForAccess,
  updateScheduledClassForAccess,
  type ScheduledClassAccessScope,
} from '@/lib/server/scheduled-classes';
import {
  buildRequestOrigin,
  isValidClassroomId,
  readClassroom,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';
import type { ScheduledClassEventInput } from '@/lib/types/scheduled-classes';

const log = createLogger('Scheduled Classes API');

interface ScheduledClassRequestBody {
  id?: unknown;
  title?: unknown;
  startsAt?: unknown;
  durationMinutes?: unknown;
  classroomId?: unknown;
  multiplayerGame?: unknown;
}

function getScope(auth: Awaited<ReturnType<typeof requireRequestRole>>): ScheduledClassAccessScope {
  if (auth instanceof NextResponse) {
    throw new Error('Cannot build schedule scope from an auth response');
  }

  return {
    role: auth.session.role,
    userId: auth.user.id,
    organizationId: auth.session.organizationId ?? null,
  };
}

function readInput(body: ScheduledClassRequestBody | null): ScheduledClassEventInput {
  return {
    title: typeof body?.title === 'string' ? body.title : '',
    startsAt: typeof body?.startsAt === 'string' ? body.startsAt : '',
    durationMinutes:
      body?.durationMinutes === null || body?.durationMinutes === undefined
        ? undefined
        : Number(body.durationMinutes),
    classroomId:
      typeof body?.classroomId === 'string' && body.classroomId.trim()
        ? body.classroomId.trim()
        : undefined,
    multiplayerGame:
      body?.multiplayerGame && typeof body.multiplayerGame === 'object'
        ? (body.multiplayerGame as ScheduledClassEventInput['multiplayerGame'])
        : undefined,
  };
}

function isGameCapableClassroom(classroom: PersistedClassroomData) {
  if (classroom.stage.sourceContext?.creationMode === 'game-arcade') {
    return true;
  }

  return classroom.scenes.some(
    (scene) => scene.content.type === 'interactive' && scene.content.widgetType === 'game',
  );
}

async function canScopeLinkClassroom(scope: ScheduledClassAccessScope, classroomId: string) {
  if (!isValidClassroomId(classroomId)) {
    return false;
  }

  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return false;
  }

  if (scope.role === 'system_admin') return true;
  if (scope.role === 'org_admin') {
    return !!scope.organizationId && classroom.organizationId === scope.organizationId;
  }
  return classroom.ownerUserId === scope.userId;
}

async function validateClassroomLink(
  request: NextRequest,
  scope: ScheduledClassAccessScope,
  input: ScheduledClassEventInput,
) {
  if (!input.classroomId) {
    return null;
  }

  if (await canScopeLinkClassroom(scope, input.classroomId)) {
    return null;
  }

  return apiErrorWithRequestSession(
    request,
    API_ERROR_CODES.INVALID_REQUEST,
    400,
    'Choose an accessible classroom for this scheduled class.',
  );
}

async function validateMultiplayerGameLink(
  request: NextRequest,
  scope: ScheduledClassAccessScope,
  input: ScheduledClassEventInput,
) {
  if (!input.multiplayerGame?.enabled) {
    return null;
  }

  if (!input.classroomId) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Choose a game-mode classroom before enabling multiplayer.',
    );
  }

  if (!isValidClassroomId(input.classroomId)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Choose an accessible classroom for this scheduled class.',
    );
  }

  const classroom = await readClassroom(input.classroomId);
  if (!classroom || !(await canScopeLinkClassroom(scope, input.classroomId))) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Choose an accessible classroom for this scheduled class.',
    );
  }

  if (!isGameCapableClassroom(classroom)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Multiplayer scheduling is available for game-mode classrooms only.',
    );
  }

  return null;
}

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const events = await listScheduledClassesForAccess(getScope(auth));
    return apiSuccessWithRequestSession(request, { events });
  } catch (error) {
    log.error('Failed to list scheduled classes:', error);
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to list scheduled classes',
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function POST(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const scope = getScope(auth);
  try {
    const body = (await request.json().catch(() => null)) as ScheduledClassRequestBody | null;
    const input = readInput(body);
    const linkError = await validateClassroomLink(request, scope, input);
    if (linkError) return linkError;
    const multiplayerLinkError = await validateMultiplayerGameLink(request, scope, input);
    if (multiplayerLinkError) return multiplayerLinkError;

    const event = await createScheduledClassForAccess(scope, input, {
      multiplayerInviteBaseUrl: buildRequestOrigin(request),
    });
    return apiSuccessWithRequestSession(request, { event }, 201);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to create scheduled class';
    const status = message.startsWith('Failed to') ? 500 : 400;
    log.error('Failed to create scheduled class:', error);
    return apiErrorWithRequestSession(
      request,
      status === 400 ? API_ERROR_CODES.INVALID_REQUEST : API_ERROR_CODES.INTERNAL_ERROR,
      status,
      message,
    );
  }
}

export async function PATCH(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const scope = getScope(auth);
  try {
    const body = (await request.json().catch(() => null)) as ScheduledClassRequestBody | null;
    const id = typeof body?.id === 'string' ? body.id.trim() : '';
    if (!id) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required field: id',
      );
    }

    const input = readInput(body);
    const linkError = await validateClassroomLink(request, scope, input);
    if (linkError) return linkError;
    const multiplayerLinkError = await validateMultiplayerGameLink(request, scope, input);
    if (multiplayerLinkError) return multiplayerLinkError;

    const event = await updateScheduledClassForAccess(scope, id, input, {
      multiplayerInviteBaseUrl: buildRequestOrigin(request),
    });
    if (!event) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.INVALID_REQUEST,
        404,
        'Scheduled class not found',
      );
    }

    return apiSuccessWithRequestSession(request, { event });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to update scheduled class';
    const status = message.startsWith('Failed to') ? 500 : 400;
    log.error('Failed to update scheduled class:', error);
    return apiErrorWithRequestSession(
      request,
      status === 400 ? API_ERROR_CODES.INVALID_REQUEST : API_ERROR_CODES.INTERNAL_ERROR,
      status,
      message,
    );
  }
}

export async function DELETE(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  try {
    const body = (await request.json().catch(() => null)) as ScheduledClassRequestBody | null;
    const id =
      (typeof body?.id === 'string' ? body.id.trim() : '') ||
      request.nextUrl.searchParams.get('id')?.trim() ||
      '';

    if (!id) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.MISSING_REQUIRED_FIELD,
        400,
        'Missing required field: id',
      );
    }

    const deleted = await deleteScheduledClassForAccess(getScope(auth), id);
    if (!deleted) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.INVALID_REQUEST,
        404,
        'Scheduled class not found',
      );
    }

    return apiSuccessWithRequestSession(request, { event: null });
  } catch (error) {
    log.error('Failed to delete scheduled class:', error);
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INTERNAL_ERROR,
      500,
      'Failed to delete scheduled class',
      error instanceof Error ? error.message : String(error),
    );
  }
}
