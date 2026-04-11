import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { CLASSROOM_ACCESS_COOKIE_NAME } from '@/lib/auth/constants';

const getRequestAuthMock = vi.fn();
const resolveAuthContextFromTokenMock = vi.fn();

vi.mock('@/lib/auth/current-user', () => ({
  getRequestAuth: getRequestAuthMock,
  resolveAuthContextFromToken: resolveAuthContextFromTokenMock,
}));

describe('classroom access helper', () => {
  beforeEach(() => {
    vi.resetModules();
    getRequestAuthMock.mockReset();
    getRequestAuthMock.mockResolvedValue(null);
    resolveAuthContextFromTokenMock.mockReset();
    resolveAuthContextFromTokenMock.mockResolvedValue(null);
  });

  it('rejects unauthenticated requests without a classroom cookie', async () => {
    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');

    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('allows teacher requests through the first-party session', async () => {
    getRequestAuthMock.mockResolvedValue({
      session: { kind: 'web', role: 'teacher' },
      user: { id: 'teacher-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const result = await requireClassroomAccess(
      new NextRequest('http://localhost/api/classroom?id=room-1'),
      'room-1',
    );

    expect(result).toEqual({
      auth: {
        session: { kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    expect(resolveAuthContextFromTokenMock).not.toHaveBeenCalled();
  });

  it('accepts a valid classroom session cookie for the matching classroom', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'classroom', classroomId: 'room-1', role: 'student' },
      user: { id: 'student-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=raw-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toEqual({
      auth: {
        session: { id: 'session-1', kind: 'classroom', classroomId: 'room-1', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
    });
  });

  it('clears the cookie when the classroom session does not match', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'classroom', classroomId: 'room-2', role: 'student' },
      user: { id: 'student-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=raw-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('clears the cookie when the classroom session has expired', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue(null);

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=session-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });

  it('clears the cookie when the session is not a classroom session', async () => {
    resolveAuthContextFromTokenMock.mockResolvedValue({
      session: { id: 'session-1', kind: 'web', classroomId: null, role: 'student' },
      user: { id: 'student-1' },
    });

    const { requireClassroomAccess } = await import('@/lib/auth/classroom-access');
    const request = new NextRequest('http://localhost/api/classroom?id=room-1', {
      headers: {
        cookie: `${CLASSROOM_ACCESS_COOKIE_NAME}=session-token`,
      },
    });
    const result = await requireClassroomAccess(request, 'room-1');

    expect(result).toBeInstanceOf(NextResponse);
    const response = result as NextResponse;
    expect(response.status).toBe(401);
    expect(response.cookies.get(CLASSROOM_ACCESS_COOKIE_NAME)?.value).toBe('');
  });
});
