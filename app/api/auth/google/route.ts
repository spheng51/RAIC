import { NextRequest, NextResponse } from 'next/server';
import { verifyGoogleIdToken } from '@/lib/auth/google';
import { getDefaultLandingPath } from '@/lib/auth/authorize';
import { AUTH_NONCE_COOKIE_NAME } from '@/lib/auth/constants';
import {
  attachSessionCookie,
  clearNonceCookie,
  clearSessionCookie,
  createWebSession,
  getRequestIpAddress,
} from '@/lib/auth/session';
import { ensureMembership, listMembershipsForUser } from '@/lib/db/repositories/memberships';
import { findOrCreatePersonalOrganization } from '@/lib/db/repositories/organizations';
import { upsertGoogleUser } from '@/lib/db/repositories/users';
import { recordAuditEvent } from '@/lib/server/audit-log';

function resolveTeacherRole(email: string) {
  const adminEmails =
    process.env.RAIC_ADMIN_EMAILS?.split(',')
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean) ?? [];

  return adminEmails.includes(email.trim().toLowerCase()) ? 'org_admin' : 'teacher';
}

function sanitizeRedirectPath(redirectTo: unknown, role: 'teacher' | 'org_admin') {
  if (typeof redirectTo !== 'string' || !redirectTo.startsWith('/')) {
    return getDefaultLandingPath(role);
  }

  if (redirectTo.startsWith('//')) {
    return getDefaultLandingPath(role);
  }

  return redirectTo;
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      credential?: string;
      redirectTo?: string;
    };
    const nonce = request.cookies.get(AUTH_NONCE_COOKIE_NAME)?.value;

    if (!body.credential) {
      return NextResponse.json(
        {
          success: false,
          errorCode: 'MISSING_CREDENTIAL',
          error: 'Google credential is required',
        },
        { status: 400 },
      );
    }

    if (!nonce) {
      const response = NextResponse.json(
        {
          success: false,
          errorCode: 'MISSING_NONCE',
          error: 'Google sign-in nonce is missing. Start again from the sign-in page.',
        },
        { status: 400 },
      );
      clearNonceCookie(response);
      clearSessionCookie(response);
      return response;
    }

    const identity = await verifyGoogleIdToken({
      idToken: body.credential,
      expectedNonce: nonce,
    });

    const user = await upsertGoogleUser(identity);
    const organization = await findOrCreatePersonalOrganization(user);
    const role = resolveTeacherRole(user.email);
    const membership = await ensureMembership({
      organizationId: organization.id,
      userId: user.id,
      role,
    });
    const session = await createWebSession({
      userId: user.id,
      organizationId: organization.id,
      role: membership.role,
      userAgent: request.headers.get('user-agent'),
      ipAddress: getRequestIpAddress(request),
    });

    await recordAuditEvent({
      organizationId: organization.id,
      userId: user.id,
      actorRole: membership.role,
      action: 'auth.google.sign_in',
      resourceType: 'session',
      resourceId: session.session.id,
      metadata: {
        email: user.email,
        membershipCount: (await listMembershipsForUser(user.id)).length,
      },
    });

    const response = NextResponse.json({
      success: true,
      redirectTo: sanitizeRedirectPath(body.redirectTo, membership.role as 'teacher' | 'org_admin'),
      role: membership.role,
    });
    clearNonceCookie(response);
    attachSessionCookie(response, session.token, session.session.absoluteExpiresAt);
    return response;
  } catch (error) {
    const response = NextResponse.json(
      {
        success: false,
        errorCode: 'GOOGLE_AUTH_FAILED',
        error: error instanceof Error ? error.message : 'Google sign-in failed',
      },
      { status: 401 },
    );
    clearNonceCookie(response);
    clearSessionCookie(response);
    return response;
  }
}
