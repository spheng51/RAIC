import { type NextRequest, NextResponse } from 'next/server';
import { SESSION_COOKIE_NAME } from '@/lib/auth/constants';
import { attachSessionCookie, resolveSessionFromToken } from '@/lib/auth/session';

export const API_ERROR_CODES = {
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  MISSING_API_KEY: 'MISSING_API_KEY',
  INVALID_REQUEST: 'INVALID_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  INVALID_URL: 'INVALID_URL',
  REDIRECT_NOT_ALLOWED: 'REDIRECT_NOT_ALLOWED',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  UPSTREAM_TIMEOUT: 'UPSTREAM_TIMEOUT',
  CONTENT_SENSITIVE: 'CONTENT_SENSITIVE',
  UPSTREAM_ERROR: 'UPSTREAM_ERROR',
  GENERATION_FAILED: 'GENERATION_FAILED',
  TRANSCRIPTION_FAILED: 'TRANSCRIPTION_FAILED',
  PARSE_FAILED: 'PARSE_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[keyof typeof API_ERROR_CODES];

export interface ApiErrorBody {
  success: false;
  errorCode: ApiErrorCode;
  error: string;
  details?: string;
}

export function apiError(
  code: ApiErrorCode,
  status: number,
  error: string,
  details?: string,
): NextResponse<ApiErrorBody> {
  return NextResponse.json(
    {
      success: false as const,
      errorCode: code,
      error,
      ...(details ? { details } : {}),
    },
    { status },
  );
}

export function apiSuccess<T extends object>(data: T, status = 200): NextResponse {
  return NextResponse.json({ success: true, ...(data as object) }, { status });
}

export async function withRequestWebSession<T extends NextResponse>(
  request: NextRequest,
  response: T,
): Promise<T> {
  const sessionToken = request.cookies.get(SESSION_COOKIE_NAME)?.value ?? null;
  if (!sessionToken) {
    return response;
  }

  const session = await resolveSessionFromToken(sessionToken);
  if (!session || session.kind !== 'web') {
    return response;
  }

  attachSessionCookie(response, sessionToken, session.expiresAt);
  return response;
}

export async function apiSuccessWithRequestSession<T extends object>(
  request: NextRequest,
  data: T,
  status = 200,
): Promise<NextResponse> {
  return withRequestWebSession(request, apiSuccess(data, status));
}

export async function apiErrorWithRequestSession(
  request: NextRequest,
  code: ApiErrorCode,
  status: number,
  error: string,
  details?: string,
): Promise<NextResponse<ApiErrorBody>> {
  return withRequestWebSession(request, apiError(code, status, error, details));
}
