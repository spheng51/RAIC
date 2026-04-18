import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  getClassroomSessionContext,
  normalizeRevisitIntent,
  normalizeSceneProgress,
  normalizeStringList,
  upsertClassroomSessionContext,
} from '@/lib/server/classroom-intelligence';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

interface SessionContextBody {
  requirement?: string;
  stageName?: string;
  language?: string;
  lastCompletedSceneId?: string | null;
  lastCompletedSceneTitle?: string | null;
  completedSceneCount?: number;
  totalSceneCount?: number;
  masteryHints?: string[];
  revisitIntent?: 'continue' | 'revisit' | 'remediate' | 'deepen';
}

function canWriteTeacherContext(
  access: Exclude<Awaited<ReturnType<typeof requireClassroomAccess>>, NextResponse>,
) {
  return access.source === 'web' && access.auth.session.role !== 'student';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseSceneCount(value: unknown, fieldName: 'completedSceneCount' | 'totalSceneCount') {
  if (value === undefined) {
    return undefined;
  }

  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    !Number.isInteger(value)
  ) {
    throw new Error(`${fieldName} must be a non-negative integer`);
  }

  return value;
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

  if (!canWriteTeacherContext(access)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Adaptive session context is only available for authenticated teacher-managed classrooms',
    );
  }

  const context = await getClassroomSessionContext({
    classroomId: id,
    userId: access.auth.user.id,
  });

  return apiSuccessWithRequestSession(request, { context });
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  if (!canWriteTeacherContext(access)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Adaptive session context is only available for authenticated teacher-managed classrooms',
    );
  }

  const rawBody = await request.json().catch(() => null);
  if (!isPlainObject(rawBody)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Session context body must be a JSON object',
    );
  }

  let completedSceneCount: number | undefined;
  let requestedTotalSceneCount: number | undefined;
  try {
    completedSceneCount = parseSceneCount(rawBody.completedSceneCount, 'completedSceneCount');
    requestedTotalSceneCount = parseSceneCount(rawBody.totalSceneCount, 'totalSceneCount');
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      error instanceof Error ? error.message : 'Invalid scene progress counts',
    );
  }

  if (
    completedSceneCount !== undefined &&
    requestedTotalSceneCount !== undefined &&
    completedSceneCount > requestedTotalSceneCount
  ) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'completedSceneCount cannot exceed totalSceneCount',
    );
  }

  if (rawBody.masteryHints !== undefined && !Array.isArray(rawBody.masteryHints)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'masteryHints must be an array of strings',
    );
  }

  const body = rawBody as SessionContextBody;
  const revisitIntent = normalizeRevisitIntent(body.revisitIntent);
  if (body.revisitIntent !== undefined && revisitIntent !== body.revisitIntent) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'revisitIntent is invalid',
    );
  }
  const normalizedCounts = normalizeSceneProgress({
    completedSceneCount: completedSceneCount ?? 0,
    totalSceneCount: requestedTotalSceneCount ?? access.classroom.scenes.length,
  });

  const context = await upsertClassroomSessionContext({
    classroomId: id,
    organizationId: access.classroom.organizationId,
    userId: access.auth.user.id,
    requirement: body.requirement,
    stageName: body.stageName || access.classroom.stage.name,
    language: body.language || access.classroom.stage.language || 'en-US',
    lastCompletedSceneId: body.lastCompletedSceneId ?? null,
    lastCompletedSceneTitle: body.lastCompletedSceneTitle ?? null,
    completedSceneCount: normalizedCounts.completedSceneCount,
    totalSceneCount: normalizedCounts.totalSceneCount,
    masteryHints: normalizeStringList(body.masteryHints),
    revisitIntent,
  });

  return apiSuccessWithRequestSession(request, { context });
}
