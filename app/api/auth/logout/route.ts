import { NextRequest, NextResponse } from 'next/server';
import { clearClassroomAccessCookie } from '@/lib/auth/classroom-access';
import { getRequestAuth } from '@/lib/auth/current-user';
import { clearNonceCookie, clearSessionCookie } from '@/lib/auth/session';
import { revokeSessionById } from '@/lib/db/repositories/sessions';
import { recordAuditEvent } from '@/lib/server/audit-log';

export async function POST(request: NextRequest) {
  const auth = await getRequestAuth(request);

  if (auth) {
    await revokeSessionById(auth.session.id);
    await recordAuditEvent({
      organizationId: auth.session.organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'auth.sign_out',
      resourceType: 'session',
      resourceId: auth.session.id,
    });
  }

  const response = NextResponse.json({ success: true });
  clearSessionCookie(response);
  clearNonceCookie(response);
  clearClassroomAccessCookie(response);
  return response;
}
