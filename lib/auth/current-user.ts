import 'server-only';

import { cache } from 'react';
import { cookies } from 'next/headers';
import type { NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { resolveSessionFromToken } from '@/lib/auth/session';
import { listMembershipsForUser } from '@/lib/db/repositories/memberships';
import { findOrganizationById } from '@/lib/db/repositories/organizations';
import { findUserById } from '@/lib/db/repositories/users';
import type { MembershipRecord, OrganizationRecord, SessionRecord, UserRecord } from '@/lib/db/schema';

export interface AuthContext {
  user: UserRecord;
  session: SessionRecord;
  memberships: MembershipRecord[];
  activeMembership: MembershipRecord | null;
  organization: OrganizationRecord | null;
}

export async function resolveAuthContextFromToken(
  sessionToken: string | null,
): Promise<AuthContext | null> {
  if (!sessionToken) return null;

  const session = await resolveSessionFromToken(sessionToken);
  if (!session) return null;

  const user = await findUserById(session.userId);
  if (!user) return null;

  const memberships = await listMembershipsForUser(user.id);
  const activeMembership =
    (session.organizationId
      ? memberships.find((membership) => membership.organizationId === session.organizationId)
      : null) ?? memberships[0] ?? null;
  const organization = activeMembership
    ? await findOrganizationById(activeMembership.organizationId)
    : null;

  return {
    user,
    session,
    memberships,
    activeMembership,
    organization,
  };
}

export const getCurrentAuth = cache(async (): Promise<AuthContext | null> => {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value ?? null;
  return resolveAuthContextFromToken(token);
});

export async function getRequestAuth(request: NextRequest): Promise<AuthContext | null> {
  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  return resolveAuthContextFromToken(token);
}
