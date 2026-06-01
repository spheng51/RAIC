import { describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(async () => null),
}));

import { getRequestAuth } from '@/lib/auth/current-user';
import {
  requireRequestRole,
  resolvePostAuthRedirectPath,
  sanitizePostAuthRedirectPath,
} from '@/lib/auth/authorize';

describe('auth redirect helpers', () => {
  it('keeps safe in-app redirect targets', () => {
    expect(sanitizePostAuthRedirectPath('/admin?tab=providers')).toBe('/admin?tab=providers');
    expect(resolvePostAuthRedirectPath('teacher', '/classroom/demo')).toBe('/classroom/demo');
  });

  it('drops sign-in and api redirect targets', () => {
    expect(sanitizePostAuthRedirectPath('/sign-in')).toBeNull();
    expect(sanitizePostAuthRedirectPath('/sign-in?next=%2Fadmin')).toBeNull();
    expect(sanitizePostAuthRedirectPath('/api/auth/google')).toBeNull();
  });

  it('drops malformed redirect targets and falls back to the role default', () => {
    expect(sanitizePostAuthRedirectPath('//evil.example.com')).toBeNull();
    expect(resolvePostAuthRedirectPath('teacher', '//evil.example.com')).toBe('/studio');
    expect(resolvePostAuthRedirectPath('org_admin', undefined)).toBe('/admin');
  });
});

describe('request role authorization', () => {
  it('rejects student web sessions from teacher-only request gates', async () => {
    const now = '2026-05-31T00:00:00.000Z';
    const activeMembership = {
      id: 'membership-1',
      organizationId: 'org-1',
      userId: 'student-1',
      role: 'student' as const,
      createdAt: now,
      updatedAt: now,
    };

    vi.mocked(getRequestAuth).mockResolvedValueOnce({
      session: {
        id: 'student-session',
        userId: 'student-1',
        organizationId: 'org-1',
        classroomId: null,
        kind: 'web',
        role: 'student',
        tokenHash: 'student-session-hash',
        userAgent: null,
        ipAddress: null,
        createdAt: now,
        updatedAt: now,
        lastSeenAt: now,
        expiresAt: '2099-05-31T00:00:00.000Z',
        absoluteExpiresAt: '2099-05-31T00:00:00.000Z',
        revokedAt: null,
      },
      user: {
        id: 'student-1',
        googleSub: null,
        email: 'student@example.test',
        displayName: 'Student One',
        avatarUrl: null,
        createdAt: now,
        updatedAt: now,
        lastLoginAt: now,
      },
      memberships: [activeMembership],
      activeMembership,
      organization: {
        id: 'org-1',
        name: 'Example School',
        slug: 'example-school',
        kind: 'school',
        domainAllowlist: [],
        createdAt: now,
        updatedAt: now,
      },
    });

    const response = await requireRequestRole(
      new NextRequest('http://localhost/api/integrations/discord/connection'),
      ['teacher'],
    );

    expect(response).toBeInstanceOf(Response);
    expect((response as Response).status).toBe(403);
    await expect((response as Response).json()).resolves.toMatchObject({
      success: false,
      errorCode: 'FORBIDDEN',
    });
  });
});
