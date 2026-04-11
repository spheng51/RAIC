import 'server-only';

import { NextRequest, NextResponse } from 'next/server';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';
import { getRequestAuth, resolveAuthContextFromToken, type AuthContext } from '@/lib/auth/current-user';
import { hashToken } from '@/lib/auth/session';
import { findJoinTokenByHash } from '@/lib/db/repositories/join-tokens';

export interface ClassroomAccessContext {
  auth: AuthContext;
  source: 'web' | 'classroom';
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

export async function requireClassroomAccess(
  request: NextRequest,
  classroomId: string,
): Promise<ClassroomAccessContext | NextResponse> {
  const auth = await getRequestAuth(request);
  if (auth && auth.session.kind === 'web' && auth.session.role !== 'student') {
    return {
      auth,
      source: 'web',
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

  if (classroomAuth.session.kind !== 'classroom' || classroomAuth.session.classroomId !== classroomId) {
    return classroomAccessError('This classroom session does not match the requested classroom');
  }

  return {
    auth: classroomAuth,
    source: 'classroom',
  };
}
