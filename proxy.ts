import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import {
  attachSessionCookie,
  clearSessionCookie,
  resolveSessionFromToken,
} from '@/lib/auth/session';
import { ACCESS_CODE_COOKIE_NAME, verifyAccessToken } from '@/lib/server/access-code';

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const accessCode = process.env.ACCESS_CODE?.trim() || '';
  const isAccessCodeAllowlisted =
    pathname.startsWith('/api/access-code/') ||
    pathname.startsWith('/api/server-providers') ||
    pathname === '/api/health';

  if (accessCode && pathname.startsWith('/api/') && !isAccessCodeAllowlisted) {
    const accessToken = request.cookies.get(ACCESS_CODE_COOKIE_NAME)?.value ?? null;
    if (!accessToken || !verifyAccessToken(accessToken, accessCode)) {
      return NextResponse.json(
        {
          success: false,
          errorCode: 'INVALID_REQUEST',
          error: 'Access code required',
        },
        { status: 401 },
      );
    }
  }

  if (!pathname.startsWith('/studio') && !pathname.startsWith('/admin')) {
    return NextResponse.next();
  }

  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (sessionCookie) {
    const session = await resolveSessionFromToken(sessionCookie);
    if (session?.kind === 'web') {
      const response = NextResponse.next();
      attachSessionCookie(response, sessionCookie, session.absoluteExpiresAt);
      return response;
    }
  }

  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('next', `${pathname}${search}`);
  const response = NextResponse.redirect(signInUrl);
  clearSessionCookie(response);
  return response;
}

export const config = {
  matcher: ['/studio/:path*', '/admin/:path*', '/api/:path*'],
};
