import { NextResponse, type NextRequest } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';

function isApiPath(pathname: string) {
  return pathname.startsWith('/api/');
}

export function proxy(request: NextRequest) {
  const sessionCookie = request.cookies.get(SESSION_COOKIE_NAME)?.value;

  if (sessionCookie) {
    return NextResponse.next();
  }

  if (isApiPath(request.nextUrl.pathname)) {
    return NextResponse.json(
      {
        success: false,
        errorCode: 'UNAUTHORIZED',
        error: 'Authentication required',
      },
      { status: 401 },
    );
  }

  const signInUrl = new URL('/sign-in', request.url);
  signInUrl.searchParams.set('next', `${request.nextUrl.pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(signInUrl);
}

export const config = {
  matcher: ['/studio/:path*', '/admin/:path*', '/api/classroom/join-token'],
};
