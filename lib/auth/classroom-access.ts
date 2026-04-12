import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';
import {
  getRequestAuth,
  resolveAuthContextFromToken,
  type AuthContext,
} from '@/lib/auth/current-user';
import { findLatestAuditLogByActionAndResource } from '@/lib/db/repositories/audit-logs';
import { hashToken } from '@/lib/auth/session';
import { findJoinTokenByHash } from '@/lib/db/repositories/join-tokens';
import {
  readClassroom,
  updateClassroom,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';

export interface ClassroomAccessContext {
  auth: AuthContext;
  source: 'web' | 'classroom';
  classroom: PersistedClassroomData;
}

function isSecureCookieRequest() {
  return process.env.NODE_ENV === 'production';
}

export function attachClassroomAccessCookie(
  response: NextResponse,
  token: string,
  expiresAt: string,
) {
  response.cookies.set({
    name: CLASSROOM_ACCESS_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearClassroomAccessCookie(response: NextResponse) {
  response.cookies.set({
    name: CLASSROOM_ACCESS_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(),
    path: '/',
    maxAge: 0,
  });
}

export async function findValidJoinToken(rawToken: string) {
  if (!rawToken) return null;

  const joinToken = await findJoinTokenByHash(hashToken(rawToken));
  if (!joinToken) return null;

  const expiresAt = new Date(joinToken.expiresAt).getTime();
  if (Number.isNaN(expiresAt) || expiresAt <= Date.now()) {
    return null;
  }

  return joinToken;
}

function classroomAccessError(message: string) {
  const response = NextResponse.json(
    {
      success: false,
      errorCode: 'UNAUTHORIZED',
      error: message,
    },
    { status: 401 },
  );
  clearClassroomAccessCookie(response);
  return response;
}

function classroomForbidden(message: string) {
  return NextResponse.json(
    {
      success: false,
      errorCode: 'FORBIDDEN',
      error: message,
    },
    { status: 403 },
  );
}

function classroomNotFound() {
  return NextResponse.json(
    {
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'Classroom not found',
    },
    { status: 404 },
  );
}

async function resolveClassroomOwnership(
  classroomId: string,
): Promise<PersistedClassroomData | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return null;
  }

  if (classroom.ownerUserId && classroom.organizationId) {
    return classroom;
  }

  const auditLog = await findLatestAuditLogByActionAndResource({
    action: 'classroom.created',
    resourceType: 'classroom',
    resourceId: classroomId,
  });

  if (!auditLog?.userId) {
    return classroom;
  }

  const backfilled = await updateClassroom(classroomId, (current) => ({
    ...current,
    ownerUserId: current.ownerUserId ?? auditLog.userId,
    organizationId: current.organizationId ?? auditLog.organizationId ?? null,
  }));

  return backfilled ?? classroom;
}

function canWebSessionAccessClassroom(
  auth: AuthContext,
  classroom: PersistedClassroomData,
): boolean {
  switch (auth.session.role) {
    case 'teacher':
      return classroom.ownerUserId === auth.user.id;
    case 'org_admin':
      return !!classroom.organizationId && classroom.organizationId === auth.session.organizationId;
    case 'system_admin':
      return true;
    default:
      return false;
  }
}

export async function requireClassroomAccess(
  request: NextRequest,
  classroomId: string,
): Promise<ClassroomAccessContext | NextResponse> {
  const classroom = await resolveClassroomOwnership(classroomId);
  if (!classroom) {
    return classroomNotFound();
  }

  const auth = await getRequestAuth(request);
  if (auth && auth.session.kind === 'web' && auth.session.role !== 'student') {
    if (!classroom.ownerUserId || !classroom.organizationId) {
      return classroomForbidden('Classroom ownership metadata is unavailable');
    }

    if (!canWebSessionAccessClassroom(auth, classroom)) {
      return classroomForbidden('You do not have permission to access this classroom');
    }

    return {
      auth,
      source: 'web',
      classroom,
    };
  }

  const classroomToken = request.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value;
  if (!classroomToken) {
    return classroomAccessError('Classroom access required');
  }

  const classroomAuth = await resolveAuthContextFromToken(classroomToken);
  if (!classroomAuth) {
    return classroomAccessError('Classroom session is invalid or has expired');
  }

  if (
    classroomAuth.session.kind !== 'classroom' ||
    classroomAuth.session.classroomId !== classroomId
  ) {
    return classroomAccessError('This classroom session does not match the requested classroom');
  }

  return {
    auth: classroomAuth,
    source: 'classroom',
    classroom,
  };
}
