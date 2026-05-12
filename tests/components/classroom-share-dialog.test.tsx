// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, options?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'classroom.share.title': 'Share classroom',
        'classroom.share.description': 'Create a reusable student join link.',
        'classroom.share.displayName': 'Join link name',
        'classroom.share.displayNamePlaceholder': 'Public Demo Classroom',
        'classroom.share.duration': 'Link duration',
        'classroom.share.createLink': 'Create link',
        'classroom.share.createAnother': 'Create another link',
        'classroom.share.createFailed': 'Failed to create join link',
        'classroom.share.created': 'Join link created',
        'classroom.share.copied': 'Join link copied',
        'classroom.share.inviteCopied': 'Invite copied',
        'classroom.share.copy': 'Copy',
        'classroom.share.copyInvite': 'Copy invite',
        'classroom.share.copyLink': 'Copy join link',
        'classroom.share.copyUnavailable': 'Clipboard unavailable',
        'classroom.share.linkReady': 'Student join link',
        'classroom.share.expiresAt': `Expires ${options?.value}`,
        'classroom.share.openRaicLink': 'Open-RAIC classroom',
        'classroom.share.zoomTitle': 'Zoom live room',
        'classroom.share.zoomDescription': 'Attach an optional Zoom link.',
        'classroom.share.zoomJoinUrl': 'Zoom URL',
        'classroom.share.zoomLabel': 'Label',
        'classroom.share.zoomSave': 'Save Zoom',
        'classroom.share.zoomLoadFailed': 'Could not load Zoom link',
        'common.close': 'Close',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react');
  const passthrough = ({ children }: { children?: React.ReactNode }) =>
    React.createElement('div', null, children);

  return {
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
      open ? React.createElement('div', null, children) : null,
    DialogContent: passthrough,
    DialogDescription: passthrough,
    DialogFooter: passthrough,
    DialogHeader: passthrough,
    DialogTitle: passthrough,
  };
});

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function mountDialog() {
  const { ClassroomShareDialog } = await import('@/components/classroom/classroom-share-dialog');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      createElement(ClassroomShareDialog, {
        open: true,
        onOpenChange: vi.fn(),
        classroomId: 'room-1',
        classroomName: 'Physics demo',
      }),
    );
  });
  await flushEffects();

  return container;
}

function findButtonByText(text: string) {
  return [...document.querySelectorAll('button')].find((button) =>
    button.textContent?.includes(text),
  ) as HTMLButtonElement | undefined;
}

describe('ClassroomShareDialog', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.stubGlobal('fetch', vi.fn());
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: vi.fn().mockResolvedValue(undefined),
      },
    });
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
    document.body.innerHTML = '';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mockShareFetch() {
    vi.mocked(fetch).mockImplementation(async (input) => {
      const url = String(input);
      if (url.includes('/live-meeting')) {
        return new Response(JSON.stringify({ success: true, liveMeeting: null }), { status: 200 });
      }

      return new Response(
        JSON.stringify({
          success: true,
          joinUrl: 'https://app.example.com/join/demo-token',
          joinCode: 'demo-token',
          expiresAt: '2026-05-12T00:00:00.000Z',
        }),
        { status: 200 },
      );
    });
  }

  it('creates and copies a 24 hour join link by default', async () => {
    mockShareFetch();

    await mountDialog();
    const createButton = findButtonByText('Create link');
    expect(createButton).toBeTruthy();
    await vi.waitFor(() => expect(createButton!.disabled).toBe(false));

    await act(async () => {
      createButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    await vi.waitFor(() =>
      expect(document.body.textContent).toContain('https://app.example.com/join/demo-token'),
    );

    expect(fetch).toHaveBeenCalledWith(
      '/api/classroom/join-token',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          classroomId: 'room-1',
          displayName: 'Physics demo',
          expiresInMinutes: 1440,
        }),
      }),
    );
    expect(vi.mocked(navigator.clipboard.writeText).mock.calls[0]?.[0]).toContain(
      'https://app.example.com/join/demo-token',
    );
  });

  it('shows manual copy fallback when clipboard access fails', async () => {
    vi.mocked(navigator.clipboard.writeText).mockRejectedValue(new Error('denied'));
    mockShareFetch();

    await mountDialog();
    const createButton = findButtonByText('Create link');
    await vi.waitFor(() => expect(createButton!.disabled).toBe(false));

    await act(async () => {
      createButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    await vi.waitFor(() => expect(document.body.textContent).toContain('Clipboard unavailable'));
  });
});
