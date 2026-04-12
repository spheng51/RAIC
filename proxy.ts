import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import {
  attachSessionCookie,
  clearSessionCookie,
  resolveSessionFromToken,
} from '@/lib/auth/session';

export async function proxy(request: NextRequest) {
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
  signInUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  const response = NextResponse.redirect(signInUrl);
  clearSessionCookie(response);
  return response;
}

export const config = {
  matcher: ['/studio/:path*', '/admin/:path*'],
};
