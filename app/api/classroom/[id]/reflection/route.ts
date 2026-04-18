import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  createClassroomReflection,
  getClassroomSessionContext,
  listClassroomReflections,
  normalizeReflectionSummary,
  normalizeRevisitIntent,
  normalizeStringList,
} from '@/lib/server/classroom-intelligence';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

interface ReflectionBody {
  summary?: string;
  challengingAreas?: string[];
  confidenceScore?: number;
  revisitIntent?: 'continue' | 'revisit' | 'remediate' | 'deepen';
}

function canWriteTeacherReflection(
  access: Exclude<Awaited<ReturnType<typeof requireClassroomAccess>>, NextResponse>,
) {
  return access.source === 'web' && access.auth.session.role !== 'student';
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseConfidenceScore(value: unknown) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 5) {
    throw new Error('confidenceScore must be a number between 1 and 5');
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

  if (!canWriteTeacherReflection(access)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Session reflection is only available for authenticated teacher-managed classrooms',
    );
  }

  const [context, reflections] = await Promise.all([
    getClassroomSessionContext({
      classroomId: id,
      userId: access.auth.user.id,
    }),
    listClassroomReflections({
      classroomId: id,
      userId: access.auth.user.id,
      limit: 5,
    }),
  ]);

  return apiSuccessWithRequestSession(request, { context, reflections });
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

  if (!canWriteTeacherReflection(access)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Session reflection is only available for authenticated teacher-managed classrooms',
    );
  }

  const rawBody = await request.json().catch(() => null);
  if (!isPlainObject(rawBody)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Reflection body must be a JSON object',
    );
  }

  if (rawBody.challengingAreas !== undefined && !Array.isArray(rawBody.challengingAreas)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'challengingAreas must be an array of strings',
    );
  }

  let confidenceScore: number | undefined;
  try {
    confidenceScore = parseConfidenceScore(rawBody.confidenceScore);
  } catch (error) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      error instanceof Error ? error.message : 'Invalid confidence score',
    );
  }

  const body = rawBody as ReflectionBody;
  const revisitIntent = normalizeRevisitIntent(body.revisitIntent);
  if (body.revisitIntent !== undefined && revisitIntent !== body.revisitIntent) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'revisitIntent is invalid',
    );
  }
  const summary = normalizeReflectionSummary(body.summary);
  if (!summary) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'summary is required',
    );
  }

  const reflection = await createClassroomReflection({
    classroomId: id,
    organizationId: access.classroom.organizationId,
    userId: access.auth.user.id,
    summary,
    challengingAreas: normalizeStringList(body.challengingAreas),
    confidenceScore,
    revisitIntent,
  });

  const context = await getClassroomSessionContext({
    classroomId: id,
    userId: access.auth.user.id,
  });

  return apiSuccessWithRequestSession(request, { reflection, context }, 201);
}
