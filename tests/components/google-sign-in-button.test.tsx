// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/script', async () => {
  const React = await import('react');
  return {
    default: () => React.createElement(React.Fragment),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
    refresh: vi.fn(),
  }),
}));

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      children,
      ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) =>
      React.createElement('button', props, children),
  };
});

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function mountButton() {
  const { GoogleSignInButton } = await import('@/components/auth/google-sign-in-button');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(createElement(GoogleSignInButton, { redirectTo: '/studio' }));
  });

  return { container };
}

describe('GoogleSignInButton', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.unstubAllGlobals();
    vi.stubGlobal('fetch', vi.fn());
    delete process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  });

  afterEach(async () => {
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) continue;

      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('shows a configuration warning when the public Google client id is missing', async () => {
    const { container } = await mountButton();

    expect(container.textContent).toContain('NEXT_PUBLIC_GOOGLE_CLIENT_ID is not configured yet.');
    expect(container.textContent).toContain('Authorized JavaScript origin');
  });

  it('shows a preparation state while the nonce request is pending', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'google-client-id';
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise(() => {
            // keep pending
          }),
      ),
    );

    const { container } = await mountButton();

    expect(container.textContent).toContain('Preparing secure Google sign-in...');
  });

  it('shows a sober error state when nonce preparation fails', async () => {
    process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID = 'google-client-id';
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('Failed to prepare Google sign-in');
      }),
    );

    const { container } = await mountButton();

    await act(async () => {
      await Promise.resolve();
    });

    expect(container.textContent).toContain('Failed to prepare Google sign-in');
    expect(container.textContent).toContain('exact authorized origins');
  });
});
