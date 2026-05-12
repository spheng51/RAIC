// @vitest-environment jsdom

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type InputHTMLAttributes,
  type LabelHTMLAttributes,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      asChild,
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> &
      AnchorHTMLAttributes<HTMLAnchorElement> & {
        asChild?: boolean;
        children?: ReactNode;
      }) => {
      if (asChild && React.isValidElement(children)) {
        return React.cloneElement(children as ReactElement<Record<string, unknown>>, props);
      }
      return React.createElement('button', props, children);
    },
  };
});

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react');
  const Shell = ({
    children,
    ...props
  }: HTMLAttributes<HTMLDivElement> & { children?: ReactNode }) =>
    React.createElement('div', props, children);
  return {
    Dialog: ({ open, children }: { open?: boolean; children?: ReactNode }) =>
      open ? React.createElement('div', null, children) : null,
    DialogContent: Shell,
    DialogDescription: Shell,
    DialogFooter: Shell,
    DialogHeader: Shell,
    DialogTitle: Shell,
  };
});

vi.mock('@/components/ui/input', async () => {
  const React = await import('react');
  return {
    Input: (props: InputHTMLAttributes<HTMLInputElement>) => React.createElement('input', props),
  };
});

vi.mock('@/components/ui/label', async () => {
  const React = await import('react');
  return {
    Label: (props: LabelHTMLAttributes<HTMLLabelElement>) => React.createElement('label', props),
  };
});

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'classroom.share.title': 'Share classroom',
        'classroom.share.description': 'Create a reusable student join link for this classroom.',
        'classroom.share.displayName': 'Join link name',
        'classroom.share.duration': 'Link duration',
        'classroom.share.zoomTitle': 'Zoom live meeting',
        'classroom.share.zoomDescription': 'Attach an attendee Zoom link.',
        'classroom.share.zoomJoinUrl': 'Zoom join link',
        'classroom.share.zoomLabel': 'Room label',
        'classroom.share.zoomSave': 'Save Zoom link',
        'classroom.share.zoomUpdate': 'Update Zoom link',
        'classroom.share.zoomOpen': 'Open Zoom',
        'classroom.share.zoomRemove': 'Remove',
        'classroom.share.zoomAttached': 'Attached Zoom link',
        'classroom.share.copyInvite': 'Copy invite',
        'classroom.share.copy': 'Copy',
        'classroom.share.createLink': 'Create link',
        'classroom.share.createAnother': 'Create another link',
        'classroom.share.linkReady': 'Student join link',
        'classroom.share.copyLink': 'Copy join link',
        'classroom.share.openRaicLink': 'Open-RAIC classroom',
        'classroom.share.zoomLink': 'Zoom',
        'classroom.share.expiresAt': `Expires ${values?.value ?? ''}`,
        'common.close': 'Close',
      };
      return labels[key] ?? key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];
const fetchMock = vi.fn();
const writeTextMock = vi.fn();

function createDeferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((promiseResolve) => {
    resolve = promiseResolve;
  });
  return { promise, resolve };
}

async function flushEffects() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function setInputValue(input: HTMLInputElement, value: string) {
  const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  valueSetter?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
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
        classroomName: 'Physics 101',
      }),
    );
  });
  await flushEffects();

  return { container };
}

describe('ClassroomShareDialog Zoom bridge', () => {
  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    writeTextMock.mockReset();
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        liveMeeting: null,
      }),
    });
    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
    });
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: writeTextMock },
      configurable: true,
    });
    writeTextMock.mockResolvedValue(undefined);
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
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

  it('saves an attendee Zoom link from the share dialog', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          liveMeeting: null,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          liveMeeting: {
            provider: 'zoom',
            source: 'manual-link',
            joinUrl: 'https://zoom.us/j/123456789',
            label: 'Office hours',
            attachedAt: '2026-04-13T00:00:00.000Z',
            attachedByUserId: 'teacher-1',
          },
        }),
      });

    const { container } = await mountDialog();
    const zoomUrlInput = container.querySelector<HTMLInputElement>('#classroom-share-zoom-url');
    const zoomLabelInput = container.querySelector<HTMLInputElement>('#classroom-share-zoom-label');
    expect(zoomUrlInput).toBeTruthy();
    expect(zoomLabelInput).toBeTruthy();

    await act(async () => {
      setInputValue(zoomUrlInput!, 'https://zoom.us/j/123456789');
      setInputValue(zoomLabelInput!, 'Office hours');
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save Zoom link'),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(fetchMock).toHaveBeenCalledWith(
      '/api/classroom/room-1/live-meeting',
      expect.objectContaining({
        method: 'PUT',
        body: JSON.stringify({
          joinUrl: 'https://zoom.us/j/123456789',
          label: 'Office hours',
        }),
      }),
    );
    expect(container.textContent).toContain('Attached Zoom link');
  });

  it('copies an invite bundle with both Open-RAIC and Zoom links', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          liveMeeting: {
            provider: 'zoom',
            source: 'manual-link',
            joinUrl: 'https://zoom.us/j/123456789',
            attachedAt: '2026-04-13T00:00:00.000Z',
            attachedByUserId: 'teacher-1',
          },
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          joinUrl: 'https://app.example.com/join/raw-token',
          joinCode: 'raw-token',
          expiresAt: '2026-04-13T02:00:00.000Z',
        }),
      });

    const { container } = await mountDialog();
    const createButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Create link'),
    );
    expect(createButton).toBeTruthy();

    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      [
        'Physics 101',
        '',
        'Open-RAIC classroom: https://app.example.com/join/raw-token',
        'Zoom: https://zoom.us/j/123456789',
      ].join('\n'),
    );
    expect(container.textContent).toContain('Copy invite');
  });

  it('waits for the existing Zoom link before creating and copying an invite', async () => {
    const liveMeetingLoad = createDeferredResponse();
    fetchMock.mockReturnValueOnce(liveMeetingLoad.promise).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        joinUrl: 'https://app.example.com/join/raw-token',
        joinCode: 'raw-token',
        expiresAt: '2026-04-13T02:00:00.000Z',
      }),
    });

    const { container } = await mountDialog();
    const createButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Create link'),
    ) as HTMLButtonElement | undefined;
    expect(createButton).toBeTruthy();
    expect(createButton!.disabled).toBe(true);

    await act(async () => {
      liveMeetingLoad.resolve(
        new Response(
          JSON.stringify({
            success: true,
            liveMeeting: {
              provider: 'zoom',
              source: 'manual-link',
              joinUrl: 'https://zoom.us/j/123456789',
            },
          }),
        ),
      );
      await liveMeetingLoad.promise;
    });

    await vi.waitFor(() => expect(createButton!.disabled).toBe(false));
    await act(async () => {
      createButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(writeTextMock).toHaveBeenCalledWith(
      expect.stringContaining('Zoom: https://zoom.us/j/123456789'),
    );
  });

  it('does not let a stale Zoom load overwrite a newly saved link', async () => {
    const liveMeetingLoad = createDeferredResponse();
    fetchMock.mockReturnValueOnce(liveMeetingLoad.promise).mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        liveMeeting: {
          provider: 'zoom',
          source: 'manual-link',
          joinUrl: 'https://zoom.us/j/987654321',
          label: 'New room',
          attachedAt: '2026-04-13T00:02:00.000Z',
          attachedByUserId: 'teacher-1',
        },
      }),
    });

    const { container } = await mountDialog();
    const zoomUrlInput = container.querySelector<HTMLInputElement>('#classroom-share-zoom-url');
    const zoomLabelInput = container.querySelector<HTMLInputElement>('#classroom-share-zoom-label');
    expect(zoomUrlInput).toBeTruthy();
    expect(zoomLabelInput).toBeTruthy();

    await act(async () => {
      setInputValue(zoomUrlInput!, 'https://zoom.us/j/987654321');
      setInputValue(zoomLabelInput!, 'New room');
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save Zoom link'),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    await vi.waitFor(() =>
      expect(container.textContent).toContain('Attached Zoom link: https://zoom.us/j/987654321'),
    );

    await act(async () => {
      liveMeetingLoad.resolve(
        new Response(
          JSON.stringify({
            success: true,
            liveMeeting: {
              provider: 'zoom',
              source: 'manual-link',
              joinUrl: 'https://zoom.us/j/111111111',
              label: 'Old room',
            },
          }),
        ),
      );
      await liveMeetingLoad.promise;
    });

    expect(container.textContent).toContain('Attached Zoom link: https://zoom.us/j/987654321');
    expect(container.textContent).not.toContain('https://zoom.us/j/111111111');
  });
});
