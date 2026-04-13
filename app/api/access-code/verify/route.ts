import { timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';
import { apiError, apiSuccess } from '@/lib/server/api-response';
import {
  ACCESS_CODE_COOKIE_NAME,
  ACCESS_CODE_TOKEN_TTL_SECONDS,
  createAccessToken,
} from '@/lib/server/access-code';

export async function POST(request: Request) {
  const accessCode = process.env.ACCESS_CODE?.trim() || '';
  if (!accessCode) {
    return apiSuccess({ valid: true });
  }

  let body: { code?: string };
  try {
    body = await request.json();
  } catch {
    return apiError('INVALID_REQUEST', 400, 'Invalid JSON body');
  }

  const submittedCode = body.code?.trim();
  if (!submittedCode) {
    return apiError('INVALID_REQUEST', 401, 'Invalid access code');
  }

  const provided = new TextEncoder().encode(submittedCode);
  const expected = new TextEncoder().encode(accessCode);
  if (provided.byteLength !== expected.byteLength || !timingSafeEqual(provided, expected)) {
    return apiError('INVALID_REQUEST', 401, 'Invalid access code');
  }

  const token = createAccessToken(accessCode);
  const cookieStore = await cookies();
  cookieStore.set(ACCESS_CODE_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: ACCESS_CODE_TOKEN_TTL_SECONDS,
    secure: process.env.NODE_ENV === 'production',
  });

  return apiSuccess({ valid: true });
}
