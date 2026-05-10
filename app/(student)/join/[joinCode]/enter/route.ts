import { NextRequest, NextResponse } from 'next/server';
import {
  attachClassroomAccessCookie,
  clearClassroomAccessCookie,
  findValidJoinToken,
} from '@/lib/auth/classroom-access';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';
import { resolveAuthContextFromToken } from '@/lib/auth/current-user';
import { createClassroomSession, getRequestIpAddress } from '@/lib/auth/session';
import { ensureMembership } from '@/lib/db/repositories/memberships';
import { createClassroomGuestUser } from '@/lib/db/repositories/users';
import { createLogger } from '@/lib/logger';
import { recordAuditEvent } from '@/lib/server/audit-log';
import { readClassroom } from '@/lib/server/classroom-storage';

const log = createLogger('JoinTokenEnter');

function redirectToJoin(request: NextRequest, joinCode: string) {
  const response = NextResponse.redirect(
    new URL(`/join/${encodeURIComponent(joinCode)}`, request.url),
  );
  clearClassroomAccessCookie(response);
  return response;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ joinCode: string }> },
) {
  const { joinCode } = await params;
  const joinToken = await findValidJoinToken(joinCode);

  if (!joinToken) {
    return redirectToJoin(request, joinCode);
  }

  const classroom = await readClassroom(joinToken.classroomId);
  if (!classroom) {
    log.warn('Join token classroom lookup failed', {
      joinTokenId: joinToken.id,
      classroomId: joinToken.classroomId,
    });
    return redirectToJoin(request, joinCode);
  }

  log.info('Join token classroom lookup verified', {
    joinTokenId: joinToken.id,
    classroomId: joinToken.classroomId,
  });

  const existingClassroomToken = request.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value ?? null;
  const existingClassroomAuth = await resolveAuthContextFromToken(existingClassroomToken);
  if (
    existingClassroomToken &&
    existingClassroomAuth?.session.kind === 'classroom' &&
    existingClassroomAuth.session.classroomId === joinToken.classroomId
  ) {
    const response = NextResponse.redirect(
      new URL(`/classroom/${joinToken.classroomId}`, request.url),
    );
    attachClassroomAccessCookie(
      response,
      existingClassroomToken,
      existingClassroomAuth.session.absoluteExpiresAt,
    );
    return response;
  }

  const guestUser = await createClassroomGuestUser({
    displayName: joinToken.displayName,
    emailHint: joinToken.displayName,
  });

  if (joinToken.organizationId) {
    await ensureMembership({
      organizationId: joinToken.organizationId,
      userId: guestUser.id,
      role: 'student',
    });
  }

  const { token: classroomSessionToken, session } = await createClassroomSession({
    userId: guestUser.id,
    organizationId: joinToken.organizationId,
    classroomId: joinToken.classroomId,
    role: 'student',
    userAgent: request.headers.get('user-agent'),
    ipAddress: getRequestIpAddress(request),
    maxExpiresAt: joinToken.expiresAt,
  });

  log.info('Join token redeemed', {
    joinTokenId: joinToken.id,
    classroomId: joinToken.classroomId,
    sessionId: session.id,
  });

  await recordAuditEvent({
    organizationId: joinToken.organizationId,
    userId: guestUser.id,
    actorRole: 'student',
    action: 'classroom.join_token.redeemed',
    resourceType: 'classroom',
    resourceId: joinToken.classroomId,
    metadata: {
      joinTokenId: joinToken.id,
      displayName: joinToken.displayName,
      sessionId: session.id,
    },
  });

  const response = NextResponse.redirect(
    new URL(`/classroom/${joinToken.classroomId}`, request.url),
  );
  attachClassroomAccessCookie(response, classroomSessionToken, session.absoluteExpiresAt);
  return response;
}
