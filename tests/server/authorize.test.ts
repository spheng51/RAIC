import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentAuth: vi.fn(async () => null),
  getRequestAuth: vi.fn(async () => null),
}));

import { resolvePostAuthRedirectPath, sanitizePostAuthRedirectPath } from '@/lib/auth/authorize';

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
