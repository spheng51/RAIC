import 'server-only';

import { redirect } from 'next/navigation';
import { NextResponse, type NextRequest } from 'next/server';
import { getCurrentAuth, getRequestAuth, type AuthContext } from '@/lib/auth/current-user';
import type { PlatformRole } from '@/lib/db/schema';

const ROLE_LEVELS: Record<PlatformRole, number> = {
  student: 0,
  teacher: 1,
  org_admin: 2,
  system_admin: 3,
};

function canAccessRole(currentRole: PlatformRole, allowedRoles: PlatformRole[]) {
  return allowedRoles.some((allowedRole) => ROLE_LEVELS[currentRole] >= ROLE_LEVELS[allowedRole]);
}

export function getDefaultLandingPath(role: PlatformRole) {
  if (role === 'org_admin' || role === 'system_admin') return '/admin';
  if (role === 'teacher') return '/studio';
  return '/';
}

export async function requireUser(): Promise<AuthContext> {
  const auth = await getCurrentAuth();
  if (!auth) {
    redirect('/sign-in');
  }
  return auth;
}

export async function requireRole(allowedRoles: PlatformRole[]): Promise<AuthContext> {
  const auth = await requireUser();

  if (!canAccessRole(auth.session.role, allowedRoles)) {
    redirect('/unauthorized');
  }

  return auth;
}

export async function requireRequestRole(
  request: NextRequest,
  allowedRoles: PlatformRole[],
): Promise<AuthContext | NextResponse> {
  const auth = await getRequestAuth(request);
  if (!auth) {
    return NextResponse.json(
      {
        success: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Authentication required',
      },
      { status: 401 },
    );
  }

  if (!canAccessRole(auth.session.role, allowedRoles)) {
    return NextResponse.json(
      {
        success: false,
        errorCode: 'FORBIDDEN',
        error: 'You do not have permission to perform this action',
      },
      { status: 403 },
    );
  }

  return auth;
}
