// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/dialog', async () => {
  const React = await import('react');
  return {
    Dialog: ({
      open,
      children,
    }: {
      open: boolean;
      children?: React.ReactNode;
      onOpenChange?: (open: boolean) => void;
    }) => (open ? React.createElement('div', { 'data-testid': 'dialog' }, children) : null),
    DialogContent: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      React.createElement('div', { className }, children),
    DialogHeader: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
    DialogTitle: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('h2', null, children),
    DialogDescription: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('p', null, children),
    DialogFooter: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('div', null, children),
  };
});

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

vi.mock('@/components/ui/input', async () => {
  const React = await import('react');
  return {
    Input: (props: React.InputHTMLAttributes<HTMLInputElement>) =>
      React.createElement('input', props),
  };
});

vi.mock('@/components/ui/textarea', async () => {
  const React = await import('react');
  return {
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
      React.createElement('textarea', props),
  };
});

vi.mock('@/components/ui/select', async () => {
  const React = await import('react');

  function collectOptions(
    children: React.ReactNode,
  ): Array<{ value: string; label: React.ReactNode }> {
    const options: Array<{ value: string; label: React.ReactNode }> = [];

    React.Children.forEach(children, (child) => {
      if (!React.isValidElement(child)) {
        return;
      }

      const childProps = child.props as {
        value?: string;
        children?: React.ReactNode;
      };

      if (typeof childProps.value === 'string') {
        options.push({
          value: childProps.value,
          label: childProps.children,
        });
      }

      if (childProps.children) {
        options.push(...collectOptions(childProps.children));
      }
    });

    return options;
  }

  return {
    Select: ({
      children,
      value,
      onValueChange,
      disabled,
    }: {
      children?: React.ReactNode;
      value?: string;
      onValueChange?: (value: string) => void;
      disabled?: boolean;
    }) =>
      React.createElement(
        'select',
        {
          value,
          disabled,
          'data-testid': 'revisit-intent',
          onChange: (event: React.ChangeEvent<HTMLSelectElement>) =>
            onValueChange?.(event.target.value),
        },
        collectOptions(children).map((option) =>
          React.createElement('option', { key: option.value, value: option.value }, option.label),
        ),
      ),
    SelectTrigger: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SelectValue: () => null,
    SelectContent: ({ children }: { children?: React.ReactNode }) =>
      React.createElement(React.Fragment, null, children),
    SelectItem: ({ children, value }: { children?: React.ReactNode; value: string }) =>
      React.createElement('option', { value }, children),
  };
});

const toastErrorMock = vi.fn();
const toastSuccessMock = vi.fn();

vi.mock('sonner', () => ({
  toast: {
    error: toastErrorMock,
    success: toastSuccessMock,
  },
}));

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function flushPromises() {
  await act(async () => {
    await Promise.resolve();
  });
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function mountDialog(
  overrides: Partial<
    React.ComponentProps<
      typeof import('@/components/stage/session-reflection-dialog').SessionReflectionDialog
    >
  > = {},
) {
  const { SessionReflectionDialog } = await import('@/components/stage/session-reflection-dialog');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const props = {
    classroomId: 'class-1',
    open: true,
    onOpenChange: vi.fn(),
    onSaved: vi.fn(),
    ...overrides,
  };

  const rerender = async (
    nextOverrides: Partial<typeof props> = {},
    options: {
      flush?: boolean;
    } = {},
  ) => {
    Object.assign(props, nextOverrides);
    await act(async () => {
      root.render(createElement(SessionReflectionDialog, props));
    });

    if (options.flush ?? true) {
      await flushPromises();
      await flushPromises();
    }
  };

  await rerender();

  return { container, props, rerender };
}

describe('SessionReflectionDialog', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    toastErrorMock.mockReset();
    toastSuccessMock.mockReset();
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    while (mountedRoots.length > 0) {
      const mounted = mountedRoots.pop();
      if (!mounted) {
        continue;
      }

      await act(async () => {
        mounted.root.unmount();
      });
      mounted.container.remove();
    }
  });

  it('hydrates the latest reflection and session context into the dialog', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        success: true,
        context: {
          lastCompletedSceneTitle: 'Orbit recap',
          completedSceneCount: 2,
          totalSceneCount: 5,
          masteryHints: ['vectors', 'transfer windows'],
          reflectionSummary: 'Slow down before transfer problems.',
          confidenceScore: 2,
          revisitIntent: 'remediate',
        },
        reflections: [
          {
            summary: 'Slow down before transfer problems.',
            challengingAreas: ['vectors', 'transfer windows'],
            confidenceScore: 2,
            revisitIntent: 'remediate',
            createdAt: '2026-04-17T00:00:00.000Z',
          },
        ],
      }),
    }));
    vi.stubGlobal('fetch', fetchMock);

    const { container } = await mountDialog();

    const summary = container.querySelector('textarea');
    const challengingAreas = container.querySelector('input[placeholder*="Comma-separated"]');
    const confidence = container.querySelector('input[type="number"]');
    const revisitIntent = container.querySelector(
      'select[data-testid="revisit-intent"]',
    ) as HTMLSelectElement | null;

    expect(fetchMock).toHaveBeenCalledWith('/api/classroom/class-1/reflection');
    expect(summary).toBeTruthy();
    expect((summary as HTMLTextAreaElement).value).toBe('Slow down before transfer problems.');
    expect((challengingAreas as HTMLInputElement).value).toBe('vectors, transfer windows');
    expect((confidence as HTMLInputElement).value).toBe('2');
    expect(revisitIntent?.value).toBe('remediate');
    expect(container.textContent).toContain('Last saved context');
    expect(container.textContent).toContain('Last completed segment: Orbit recap');
    expect(container.textContent).toContain('Progress: 2/5 scenes');
    expect(container.textContent).toContain('Challenging areas: vectors, transfer windows');
  });

  it('submits the saved reflection and forwards the persisted payload', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          context: {
            revisitIntent: 'deepen',
            reflectionSummary: 'Keep the momentum going.',
            masteryHints: ['transfer windows'],
            confidenceScore: 4,
          },
          reflections: [
            {
              summary: 'Keep the momentum going.',
              challengingAreas: ['transfer windows'],
              confidenceScore: 4,
              revisitIntent: 'deepen',
              createdAt: '2026-04-17T00:00:00.000Z',
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          reflection: {
            summary: 'Keep the momentum going.',
            challengingAreas: ['transfer windows'],
            confidenceScore: 4,
            revisitIntent: 'deepen',
          },
          context: {
            revisitIntent: 'deepen',
          },
        }),
      });
    vi.stubGlobal('fetch', fetchMock);

    const onSaved = vi.fn();
    const onOpenChange = vi.fn();
    const { container } = await mountDialog({
      onSaved,
      onOpenChange,
    });

    const saveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Save Reflection'),
    );
    expect(saveButton).toBeTruthy();

    await act(async () => {
      saveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    await flushPromises();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      '/api/classroom/class-1/reflection',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      }),
    );

    const postBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(postBody).toEqual({
      summary: 'Keep the momentum going.',
      challengingAreas: ['transfer windows'],
      confidenceScore: 4,
      revisitIntent: 'deepen',
    });
    expect(onSaved).toHaveBeenCalledWith({
      reflection: {
        summary: 'Keep the momentum going.',
        challengingAreas: ['transfer windows'],
        confidenceScore: 4,
        revisitIntent: 'deepen',
      },
      context: {
        revisitIntent: 'deepen',
      },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(toastSuccessMock).toHaveBeenCalledWith('Session reflection saved.');
  });

  it('clears the previous classroom snapshot before hydrating the next classroom', async () => {
    const nextClassroomResponse = createDeferred<{
      ok: boolean;
      json: () => Promise<{
        success: boolean;
        context: {
          lastCompletedSceneTitle: string;
          completedSceneCount: number;
          totalSceneCount: number;
          masteryHints: string[];
          reflectionSummary: string;
          confidenceScore: number;
          revisitIntent: 'continue' | 'revisit' | 'remediate' | 'deepen';
        };
        reflections: Array<{
          summary: string;
          challengingAreas: string[];
          confidenceScore: number;
          revisitIntent: 'continue' | 'revisit' | 'remediate' | 'deepen';
          createdAt: string;
        }>;
      }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          context: {
            lastCompletedSceneTitle: 'Orbit recap',
            completedSceneCount: 2,
            totalSceneCount: 5,
            masteryHints: ['vectors', 'transfer windows'],
            reflectionSummary: 'Slow down before transfer problems.',
            confidenceScore: 2,
            revisitIntent: 'remediate',
          },
          reflections: [
            {
              summary: 'Slow down before transfer problems.',
              challengingAreas: ['vectors', 'transfer windows'],
              confidenceScore: 2,
              revisitIntent: 'remediate',
              createdAt: '2026-04-17T00:00:00.000Z',
            },
          ],
        }),
      })
      .mockImplementationOnce(() => nextClassroomResponse.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { container, rerender } = await mountDialog();

    await rerender({ classroomId: 'class-2' }, { flush: false });

    const summary = container.querySelector('textarea');
    const challengingAreas = container.querySelector('input[placeholder*="Comma-separated"]');
    const confidence = container.querySelector('input[type="number"]');
    const revisitIntent = container.querySelector(
      'select[data-testid="revisit-intent"]',
    ) as HTMLSelectElement | null;

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/classroom/class-2/reflection');
    expect((summary as HTMLTextAreaElement).value).toBe('');
    expect((challengingAreas as HTMLInputElement).value).toBe('');
    expect((confidence as HTMLInputElement).value).toBe('3');
    expect(revisitIntent?.value).toBe('continue');
    expect(container.textContent).not.toContain('Last saved context');
    expect(container.textContent).not.toContain('Orbit recap');

    nextClassroomResponse.resolve({
      ok: true,
      json: async () => ({
        success: true,
        context: {
          lastCompletedSceneTitle: 'Launch checklist',
          completedSceneCount: 1,
          totalSceneCount: 4,
          masteryHints: ['fuel ratio'],
          reflectionSummary: 'Start with the checklist.',
          confidenceScore: 4,
          revisitIntent: 'revisit',
        },
        reflections: [
          {
            summary: 'Start with the checklist.',
            challengingAreas: ['fuel ratio'],
            confidenceScore: 4,
            revisitIntent: 'revisit',
            createdAt: '2026-04-18T00:00:00.000Z',
          },
        ],
      }),
    });
    await flushPromises();
    await flushPromises();

    expect((summary as HTMLTextAreaElement).value).toBe('Start with the checklist.');
    expect((challengingAreas as HTMLInputElement).value).toBe('fuel ratio');
    expect((confidence as HTMLInputElement).value).toBe('4');
    expect(revisitIntent?.value).toBe('revisit');
    expect(container.textContent).toContain('Last completed segment: Launch checklist');
  });

  it('clears the last saved snapshot when reopening before the next fetch resolves', async () => {
    const reopenedResponse = createDeferred<{
      ok: boolean;
      json: () => Promise<{
        success: boolean;
        context: {
          masteryHints: string[];
          reflectionSummary: string;
          confidenceScore: number;
          revisitIntent: 'continue' | 'revisit' | 'remediate' | 'deepen';
        };
        reflections: Array<{
          summary: string;
          challengingAreas: string[];
          confidenceScore: number;
          revisitIntent: 'continue' | 'revisit' | 'remediate' | 'deepen';
          createdAt: string;
        }>;
      }>;
    }>();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          success: true,
          context: {
            masteryHints: ['vectors'],
            reflectionSummary: 'Slow down before transfer problems.',
            confidenceScore: 2,
            revisitIntent: 'remediate',
          },
          reflections: [
            {
              summary: 'Slow down before transfer problems.',
              challengingAreas: ['vectors'],
              confidenceScore: 2,
              revisitIntent: 'remediate',
              createdAt: '2026-04-17T00:00:00.000Z',
            },
          ],
        }),
      })
      .mockImplementationOnce(() => reopenedResponse.promise);
    vi.stubGlobal('fetch', fetchMock);

    const { container, rerender } = await mountDialog();

    await rerender({ open: false }, { flush: false });
    expect(container.querySelector('[data-testid="dialog"]')).toBeNull();

    await rerender({ open: true }, { flush: false });

    const summary = container.querySelector('textarea');
    const challengingAreas = container.querySelector('input[placeholder*="Comma-separated"]');
    const confidence = container.querySelector('input[type="number"]');
    const revisitIntent = container.querySelector(
      'select[data-testid="revisit-intent"]',
    ) as HTMLSelectElement | null;

    expect(fetchMock).toHaveBeenNthCalledWith(2, '/api/classroom/class-1/reflection');
    expect((summary as HTMLTextAreaElement).value).toBe('');
    expect((challengingAreas as HTMLInputElement).value).toBe('');
    expect((confidence as HTMLInputElement).value).toBe('3');
    expect(revisitIntent?.value).toBe('continue');
    expect(container.textContent).not.toContain('Last saved context');
    expect(container.textContent).not.toContain('Slow down before transfer problems.');

    reopenedResponse.resolve({
      ok: true,
      json: async () => ({
        success: true,
        context: {
          masteryHints: ['fuel ratio'],
          reflectionSummary: 'Start with the checklist.',
          confidenceScore: 4,
          revisitIntent: 'deepen',
        },
        reflections: [
          {
            summary: 'Start with the checklist.',
            challengingAreas: ['fuel ratio'],
            confidenceScore: 4,
            revisitIntent: 'deepen',
            createdAt: '2026-04-18T00:00:00.000Z',
          },
        ],
      }),
    });
    await flushPromises();
    await flushPromises();

    expect((summary as HTMLTextAreaElement).value).toBe('Start with the checklist.');
    expect((challengingAreas as HTMLInputElement).value).toBe('fuel ratio');
    expect((confidence as HTMLInputElement).value).toBe('4');
    expect(revisitIntent?.value).toBe('deepen');
  });
});
