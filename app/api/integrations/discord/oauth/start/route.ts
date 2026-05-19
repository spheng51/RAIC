import { type NextRequest, NextResponse } from 'next/server';
import { createOpaqueToken } from '@/lib/auth/session';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  API_ERROR_CODES,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import {
  buildDiscordOAuthUrl,
  DISCORD_OAUTH_STATE_COOKIE,
  getDiscordConfig,
} from '@/lib/server/discord';

export async function GET(request: NextRequest) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  if (!getDiscordConfig()) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_API_KEY,
      503,
      'Discord integration is not configured.',
    );
  }

  const state = createOpaqueToken();
  const redirectUrl = buildDiscordOAuthUrl({
    origin: buildRequestOrigin(request),
    state,
  });
  const response = NextResponse.redirect(redirectUrl);
  response.cookies.set(DISCORD_OAUTH_STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: request.nextUrl.protocol === 'https:',
    path: '/',
    maxAge: 10 * 60,
  });
  return withRequestWebSession(request, response);
}
