import { beforeEach, describe, expect, it, vi } from 'vitest';

const { redirectMock, getCurrentAuthMock } = vi.hoisted(() => ({
  redirectMock: vi.fn(),
  getCurrentAuthMock: vi.fn(),
}));

vi.mock('next/navigation', () => ({
  redirect: redirectMock,
}));

vi.mock('next/link', () => ({
  default: ({ children }: { children?: React.ReactNode }) => children ?? null,
}));

vi.mock('@/lib/auth/current-user', () => ({
  getCurrentAuth: getCurrentAuthMock,
}));

import SignInPage from '@/app/sign-in/page';

describe('SignInPage', () => {
  beforeEach(() => {
    redirectMock.mockReset();
    getCurrentAuthMock.mockReset();
  });

  it('redirects authenticated org admins to their role default when next is missing', async () => {
    getCurrentAuthMock.mockResolvedValue({
      session: {
        role: 'org_admin',
      },
    });

    await SignInPage({
      searchParams: Promise.resolve({}),
    });

    expect(redirectMock).toHaveBeenCalledWith('/admin');
  });

  it('preserves a safe next redirect for authenticated users', async () => {
    getCurrentAuthMock.mockResolvedValue({
      session: {
        role: 'org_admin',
      },
    });

    await SignInPage({
      searchParams: Promise.resolve({
        next: '/admin?tab=providers',
      }),
    });

    expect(redirectMock).toHaveBeenCalledWith('/admin?tab=providers');
  });
});
