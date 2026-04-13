// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomCollaborationStatePayload } from '@/lib/types/classroom-collaboration';
import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type { SharedSimulation } from '@/lib/types/stage';

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
    DialogFooter: ({ children, className }: { children?: React.ReactNode; className?: string }) =>
      React.createElement('div', { className }, children),
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

vi.mock('@/components/ui/label', async () => {
  const React = await import('react');
  return {
    Label: ({
      children,
      ...props
    }: React.LabelHTMLAttributes<HTMLLabelElement> & { children?: React.ReactNode }) =>
      React.createElement('label', props, children),
  };
});

vi.mock('@/components/ui/badge', async () => {
  const React = await import('react');
  return {
    Badge: ({ children }: { children?: React.ReactNode }) =>
      React.createElement('span', null, children),
  };
});

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
  },
}));

interface MountedComponent<TProps> {
  readonly container: HTMLDivElement;
  readonly rerender: (nextProps?: Partial<TProps>) => Promise<void>;
}

interface ManagerDialogTestProps {
  readonly open: boolean;
  readonly sharedSimulation: SharedSimulation | null;
  readonly participants: ClassroomPresentationParticipant[];
  readonly collaboration: ClassroomCollaborationStatePayload | null;
  readonly multiUserEnabled?: boolean;
  readonly onAttach: (input: {
    simulationId: string;
    reportId?: string;
    defaultSurface: 'lesson' | 'simulation';
    collaborationMode?: 'single-controller' | 'multi-user';
  }) => Promise<void>;
  readonly onGrantControl: (targetSessionId: string, leaseMinutes: number) => Promise<void>;
  readonly onRevokeControl: () => Promise<void>;
  readonly onCollaborationAction?: (input: {
    action: string;
    targetSessionId?: string;
  }) => Promise<void>;
}

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildSharedSimulation(overrides: Partial<SharedSimulation> = {}): SharedSimulation {
  return {
    provider: 'mirofish',
    simulationId: 'sim-1',
    reportId: 'report-1',
    runUrl: 'https://mirofish.example/simulation/sim-1/start?embed=1',
    reportUrl: 'https://mirofish.example/report/report-1?embed=1',
    activeSurface: 'simulation',
    controllerSessionId: 'student-controller',
    controllerRole: 'student',
    controlLeaseExpiresAt: '2026-04-11T00:05:00.000Z',
    collaborationMode: 'single-controller',
    collaborationState: 'inactive',
    allowStudentInteraction: false,
    status: 'running',
    ...overrides,
  };
}

async function mountDialog(
  initialOverrides: Partial<ManagerDialogTestProps> = {},
): Promise<MountedComponent<ManagerDialogTestProps>> {
  const { MiroFishManagerDialog } = await import('@/components/mirofish/mirofish-manager-dialog');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  let props: ManagerDialogTestProps = {
    open: true,
    sharedSimulation: null,
    participants: [],
    collaboration: null,
    onAttach: vi.fn(async () => {}),
    onGrantControl: vi.fn(async () => {}),
    onRevokeControl: vi.fn(async () => {}),
    onCollaborationAction: vi.fn(async () => {}),
    ...initialOverrides,
  };

  const renderWithProps = async () => {
    await act(async () => {
      root.render(
        createElement(MiroFishManagerDialog, {
          ...props,
          onOpenChange: vi.fn(),
        }),
      );
    });
  };

  await renderWithProps();

  return {
    container,
    rerender: async (nextProps = {}) => {
      props = {
        ...props,
        ...nextProps,
      };
      await renderWithProps();
    },
  };
}

describe('MiroFishManagerDialog', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    vi.useRealTimers();
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

  it('shows inline attach validation errors', async () => {
    const onAttach = vi.fn(async () => {
      throw new Error('Simulation not found');
    });

    const mounted = await mountDialog({
      onAttach,
      sharedSimulation: buildSharedSimulation({
        simulationId: 'sim-404',
        reportId: undefined,
        reportUrl: undefined,
        activeSurface: 'lesson',
        controllerSessionId: undefined,
        controllerRole: 'teacher',
        controlLeaseExpiresAt: undefined,
        status: 'attached',
      }),
    });

    const attachButton = Array.from(mounted.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Update attached MiroFish'),
    );
    expect(attachButton).toBeTruthy();

    await act(async () => {
      attachButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAttach).toHaveBeenCalledWith({
      simulationId: 'sim-404',
      reportId: undefined,
      defaultSurface: 'lesson',
      collaborationMode: 'single-controller',
    });
    expect(mounted.container.textContent).toContain('Simulation not found');
  });

  it('passes the selected lease duration and renders the active lease state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const now = new Date().toISOString();

    const participants: ClassroomPresentationParticipant[] = [
      {
        sessionId: 'student-controller',
        userId: 'student-1',
        displayName: 'Student One',
        role: 'student',
        lastSeenAt: now,
        isController: true,
      },
      {
        sessionId: 'student-target',
        userId: 'student-2',
        displayName: 'Student Two',
        role: 'student',
        lastSeenAt: now,
        isController: false,
      },
    ];
    const onGrantControl = vi.fn(async () => {});

    const mounted = await mountDialog({
      sharedSimulation: buildSharedSimulation(),
      participants,
      onGrantControl,
    });

    expect(mounted.container.textContent).toContain('Control: Student One');
    expect(mounted.container.textContent).toContain('Countdown: 5m 00s remaining');
    expect(mounted.container.textContent).toContain('active');
    expect(mounted.container.textContent).toContain('just now');

    const thirtyMinuteButton = Array.from(mounted.container.querySelectorAll('button')).find(
      (button) => button.textContent?.includes('30 minutes'),
    );
    expect(thirtyMinuteButton).toBeTruthy();

    await act(async () => {
      thirtyMinuteButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const grantButtons = Array.from(mounted.container.querySelectorAll('button')).filter((button) =>
      button.textContent?.includes('Grant control'),
    );
    expect(grantButtons).toHaveLength(1);

    await act(async () => {
      grantButtons[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onGrantControl).toHaveBeenCalledWith('student-target', 30);
    expect(mounted.container.textContent).toContain('Lease: 5m 00s remaining');
  });

  it('passes multi-user mode and collaboration actions through the manager UI', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-11T00:00:00.000Z'));
    const now = new Date().toISOString();
    const onAttach = vi.fn(async () => {});
    const onCollaborationAction = vi.fn(async () => {});
    const mounted = await mountDialog({
      multiUserEnabled: true,
      onAttach,
      onCollaborationAction,
      sharedSimulation: buildSharedSimulation({
        collaborationMode: 'multi-user',
        collaborationState: 'live',
        allowStudentInteraction: true,
        controllerSessionId: undefined,
        controllerRole: 'teacher',
        controlLeaseExpiresAt: undefined,
      }),
      collaboration: {
        collaborationMode: 'multi-user',
        collaborationState: 'live',
        allowStudentInteraction: true,
        spotlightSessionId: null,
        participantCount: 1,
        participants: [
          {
            sessionId: 'student-target',
            userId: 'student-2',
            displayName: 'Student Two',
            role: 'student',
            lastSeenAt: now,
            isRemoved: false,
            isSpotlighted: false,
            canInteract: true,
          },
        ],
        mirofishSessionId: 'miro-session-1',
        lastCollaborationSyncAt: '2026-04-11T00:00:00.000Z',
        viewerSessionId: 'teacher-session',
        viewerRole: 'teacher',
        viewerKind: 'web',
        viewerCanModerateCollaboration: true,
        viewerCanInteract: true,
        viewerIsRemoved: false,
        viewerInteractionReason: null,
        multiUserEnabled: true,
      },
    });

    const attachButton = Array.from(mounted.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Update attached MiroFish'),
    );
    expect(attachButton).toBeTruthy();

    await act(async () => {
      attachButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onAttach).toHaveBeenCalledWith(
      expect.objectContaining({
        collaborationMode: 'multi-user',
      }),
    );

    const freezeButton = Array.from(mounted.container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Freeze'),
    );
    expect(freezeButton).toBeTruthy();

    await act(async () => {
      freezeButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(onCollaborationAction).toHaveBeenCalledWith({
      action: 'freeze',
      targetSessionId: undefined,
    });
    expect(mounted.container.textContent).toContain('Mode: Multi-user');
    expect(mounted.container.textContent).toContain('Collaboration: live');
    expect(mounted.container.textContent).toContain('active');
    expect(mounted.container.textContent).toContain('just now');
  });
});
