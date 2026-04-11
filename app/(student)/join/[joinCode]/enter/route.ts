import { NextRequest, NextResponse } from 'next/server';
import {
  attachClassroomAccessCookie,
  clearClassroomAccessCookie,
  findValidJoinToken,
} from '@/lib/auth/classroom-access';
import { createClassroomSession, getRequestIpAddress } from '@/lib/auth/session';
import { ensureMembership } from '@/lib/db/repositories/memberships';
import { createClassroomGuestUser } from '@/lib/db/repositories/users';
import { recordAuditEvent } from '@/lib/server/audit-log';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ joinCode: string }> },
) {
  const { joinCode } = await params;
  const joinToken = await findValidJoinToken(joinCode);

  if (!joinToken) {
    const response = NextResponse.redirect(new URL(`/join/${encodeURIComponent(joinCode)}`, request.url));
    clearClassroomAccessCookie(response);
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

  const response = NextResponse.redirect(new URL(`/classroom/${joinToken.classroomId}`, request.url));
  attachClassroomAccessCookie(response, classroomSessionToken, session.absoluteExpiresAt);
  return response;
}
