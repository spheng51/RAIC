import 'server-only';

import { createHash, randomBytes } from 'crypto';
import type { NextRequest, NextResponse } from 'next/server';
import {
  AUTH_NONCE_COOKIE_NAME,
  SESSION_ABSOLUTE_DAYS,
  SESSION_COOKIE_NAME,
  SESSION_IDLE_HOURS,
} from '@/lib/auth/constants';
import {
  createSessionRecord,
  findSessionByTokenHash,
  revokeSessionById,
  touchSession,
} from '@/lib/db/repositories/sessions';
import type { PlatformRole, SessionRecord } from '@/lib/db/schema';

export function createOpaqueToken() {
  return randomBytes(32).toString('base64url');
}

export function createNonceToken() {
  return randomBytes(16).toString('base64url');
}

export function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

export function getRequestIpAddress(request: NextRequest) {
  const forwarded = request.headers.get('x-forwarded-for');
  return forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null;
}

export async function createWebSession(input: {
  userId: string;
  organizationId: string | null;
  role: PlatformRole;
  userAgent?: string | null;
  ipAddress?: string | null;
}) {
  const issuedAt = Date.now();
  const expiresAt = new Date(issuedAt + SESSION_IDLE_HOURS * 60 * 60 * 1000).toISOString();
  const absoluteExpiresAt = new Date(
    issuedAt + SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();
  const rawToken = createOpaqueToken();

  const session = await createSessionRecord({
    userId: input.userId,
    organizationId: input.organizationId,
    role: input.role,
    kind: 'web',
    tokenHash: hashToken(rawToken),
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    expiresAt,
    absoluteExpiresAt,
  });

  return {
    token: rawToken,
    session,
  };
}

export async function createClassroomSession(input: {
  userId: string;
  organizationId: string | null;
  classroomId: string;
  role?: PlatformRole;
  userAgent?: string | null;
  ipAddress?: string | null;
  maxExpiresAt: string;
}) {
  const issuedAt = Date.now();
  const hardLimit = new Date(input.maxExpiresAt).getTime();
  if (Number.isNaN(hardLimit) || hardLimit <= issuedAt) {
    throw new Error('Classroom session expiration is invalid');
  }

  const absoluteLimit = Math.min(hardLimit, issuedAt + SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000);
  const idleLimit = Math.min(hardLimit, issuedAt + SESSION_IDLE_HOURS * 60 * 60 * 1000);
  const rawToken = createOpaqueToken();

  const session = await createSessionRecord({
    userId: input.userId,
    organizationId: input.organizationId,
    classroomId: input.classroomId,
    role: input.role ?? 'student',
    kind: 'classroom',
    tokenHash: hashToken(rawToken),
    userAgent: input.userAgent,
    ipAddress: input.ipAddress,
    expiresAt: new Date(idleLimit).toISOString(),
    absoluteExpiresAt: new Date(absoluteLimit).toISOString(),
  });

  return {
    token: rawToken,
    session,
  };
}

export async function resolveSessionFromToken(token: string): Promise<SessionRecord | null> {
  const session = await findSessionByTokenHash(hashToken(token));
  if (!session || session.revokedAt) return null;

  const now = Date.now();
  const idleExpiry = new Date(session.expiresAt).getTime();
  const absoluteExpiry = new Date(session.absoluteExpiresAt).getTime();

  if (Number.isNaN(idleExpiry) || Number.isNaN(absoluteExpiry)) {
    await revokeSessionById(session.id);
    return null;
  }

  if (idleExpiry <= now || absoluteExpiry <= now) {
    await revokeSessionById(session.id);
    return null;
  }

  const nextIdleExpiry = new Date(
    Math.min(now + SESSION_IDLE_HOURS * 60 * 60 * 1000, absoluteExpiry),
  ).toISOString();

  await touchSession(session.id, {
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: nextIdleExpiry,
  });

  return {
    ...session,
    lastSeenAt: new Date(now).toISOString(),
    expiresAt: nextIdleExpiry,
  };
}

function isSecureCookieRequest() {
  return process.env.NODE_ENV === 'production';
}

export function attachSessionCookie(response: NextResponse, token: string, expiresAt: string) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: token,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(),
    path: '/',
    expires: new Date(expiresAt),
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(),
    path: '/',
    maxAge: 0,
  });
}

export function attachNonceCookie(response: NextResponse, nonce: string) {
  response.cookies.set({
    name: AUTH_NONCE_COOKIE_NAME,
    value: nonce,
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(),
    path: '/',
    maxAge: 10 * 60,
  });
}

export function clearNonceCookie(response: NextResponse) {
  response.cookies.set({
    name: AUTH_NONCE_COOKIE_NAME,
    value: '',
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureCookieRequest(),
    path: '/',
    maxAge: 0,
  });
}
