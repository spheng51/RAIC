// @vitest-environment jsdom

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClassroomCollaborationStatePayload } from '@/lib/types/classroom-collaboration';
import type { ClassroomPresentationParticipant } from '@/lib/types/classroom-presentation';
import type { MiroFishCreationSpec } from '@/lib/types/mirofish-authoring';
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

vi.mock('@/components/ui/textarea', async () => {
  const React = await import('react');
  return {
    Textarea: (props: React.TextareaHTMLAttributes<HTMLTextAreaElement>) =>
      React.createElement('textarea', props),
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

vi.mock('@/components/participants/participant-presence-card', async () => {
  const React = await import('react');
  return {
    ParticipantPresenceCard: ({
      name,
      activityLabel,
      trailing,
    }: {
      name: string;
      activityLabel: string;
      trailing?: React.ReactNode;
    }) =>
      React.createElement(
        'div',
        null,
        React.createElement('span', null, `${name}:${activityLabel}`),
        trailing,
      ),
  };
});

vi.mock('@/lib/utils/participant-presence', () => ({
  getParticipantActivityLabel: () => ({
    state: 'active',
    label: 'active',
  }),
  sortParticipantsByPresence: <T,>(participants: T[]) => participants,
}));

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string, vars?: Record<string, string | number>) => {
      if (vars?.count !== undefined && key === 'classroom.mirofish.leaseMinutes') {
        return `${vars.count} minutes`;
      }
      if (vars?.countdown !== undefined && key === 'classroom.mirofish.leaseShort') {
        return `Lease: ${vars.countdown}`;
      }
      if (vars?.time !== undefined && key === 'classroom.mirofish.leaseExpiresAt') {
        return `Student lease expires at ${vars.time}.`;
      }
      if (vars?.countdown !== undefined && key === 'classroom.mirofish.leaseCountdown') {
        return `Countdown: ${vars.countdown}`;
      }
      if (vars?.count !== undefined && key === 'classroom.mirofish.participantsCount') {
        return `Participants: ${vars.count}`;
      }
      if (vars?.name !== undefined) {
        return key.replace('{{name}}', String(vars.name));
      }
      return key;
    },
  }),
}));

vi.mock('sonner', () => ({
  toast: {
    error: vi.fn(),
    success: vi.fn(),
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
  readonly authoringAvailable?: boolean;
  readonly classroomContext?: {
    stageName?: string;
    currentSceneId?: string;
    currentSceneTitle?: string;
    currentSceneType?: string;
  };
  readonly onAttach: (input: {
    simulationId: string;
    reportId?: string;
    defaultSurface: 'lesson' | 'simulation';
    collaborationMode?: 'single-controller' | 'multi-user';
  }) => Promise<void>;
  readonly onGeneratePlan?: (input: unknown) => Promise<{
    spec: MiroFishCreationSpec;
    promptPreview: string;
  }>;
  readonly onCreateWithAI?: (input: { spec: MiroFishCreationSpec }) => Promise<{ jobId: string }>;
  readonly onPollCreateJob?: (jobId: string) => Promise<{
    status: 'queued' | 'running' | 'ready' | 'failed';
    error?: string;
    sharedSimulation?: SharedSimulation;
  }>;
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

function buildSpec(overrides: Partial<MiroFishCreationSpec> = {}): MiroFishCreationSpec {
  return {
    title: 'Coral Investigation',
    brief: 'Create a coral investigation for this scene.',
    goal: 'Create a coral investigation for this scene.',
    activityType: 'investigation',
    targetAudience: 'Grade 8 science',
    includeReport: true,
    defaultSurface: 'simulation',
    collaborationMode: 'single-controller',
    teacherInstructions: ['Introduce setup', 'Ask for a prediction', 'Debrief findings'],
    studentTasks: ['Change salinity', 'Observe coral', 'Compare outcomes'],
    successChecks: ['Students explain one pattern', 'Students compare two conditions'],
    reportFocus: ['Summarize the strongest pattern'],
    authoringNotes: 'Keep it compact.',
    sceneContext: {
      sceneId: 'scene-1',
      sceneTitle: 'Coral salinity lab',
      sceneType: 'interactive',
      teacherControls: [],
      misconceptionHooks: [],
    },
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
    authoringAvailable: false,
    classroomContext: {
      stageName: 'Coral Reef Lab',
      currentSceneId: 'scene-1',
      currentSceneTitle: 'Coral salinity lab',
      currentSceneType: 'interactive',
    },
    onAttach: vi.fn(async () => {}),
    onGeneratePlan: vi.fn(async () => ({
      spec: buildSpec(),
      promptPreview: 'Stage: Coral Reef Lab',
    })),
    onCreateWithAI: vi.fn(async () => ({ jobId: 'job-1' })),
    onPollCreateJob: vi.fn(async () => ({
      status: 'ready' as const,
      sharedSimulation: buildSharedSimulation({
        authoring: {
          source: 'ai-guided',
          briefPreview: 'Create a coral investigation',
          createdAt: '2026-04-20T00:00:00.000Z',
        },
      }),
    })),
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

function findButton(container: HTMLElement, text: string) {
  return Array.from(container.querySelectorAll('button')).find((button) =>
    button.textContent?.includes(text),
  );
}

function findInput(container: HTMLElement, id: string) {
  return container.querySelector(`#${id}`) as HTMLInputElement | null;
}

function findTextarea(container: HTMLElement, id: string) {
  return container.querySelector(`#${id}`) as HTMLTextAreaElement | null;
}

function setElementValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
) {
  const prototype =
    element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
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

    const attachButton = findButton(
      mounted.container,
      'classroom.mirofish.updateAttachButton',
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

  it('generates a reviewed AI plan from the dialog', async () => {
    const onGeneratePlan = vi.fn(async () => ({
      spec: buildSpec(),
      promptPreview: 'Stage: Coral Reef Lab',
    }));

    const mounted = await mountDialog({
      authoringAvailable: true,
      onGeneratePlan,
    });

    await act(async () => {
      findButton(mounted.container, 'classroom.mirofish.modeCreate')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    const goalInput = findTextarea(mounted.container, 'mirofish-goal');
    const audienceInput = findInput(mounted.container, 'mirofish-target-audience');
    expect(goalInput).toBeTruthy();
    expect(audienceInput).toBeTruthy();

    await act(async () => {
      if (goalInput) {
        setElementValue(goalInput, 'Create a coral investigation about salinity changes.');
      }
      if (audienceInput) {
        setElementValue(audienceInput, 'Grade 8 science');
      }
    });

    await act(async () => {
      findButton(mounted.container, 'classroom.mirofish.generatePlanButton')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onGeneratePlan).toHaveBeenCalledWith(
      expect.objectContaining({
        goal: 'Create a coral investigation about salinity changes.',
        targetAudience: 'Grade 8 science',
        currentSceneId: 'scene-1',
      }),
    );
    expect(mounted.container.textContent).toContain('classroom.mirofish.generatedPlanTitle');
    expect(findTextarea(mounted.container, 'mirofish-plan-preview')?.value).toContain(
      'Stage: Coral Reef Lab',
    );
  });

  it('creates and polls an AI-authored simulation, then closes on success', async () => {
    const onOpenChange = vi.fn();
    const onGeneratePlan = vi.fn(async () => ({
      spec: buildSpec(),
      promptPreview: 'Stage: Coral Reef Lab',
    }));
    const onCreateWithAI = vi.fn(async () => ({ jobId: 'job-1' }));
    const onPollCreateJob = vi.fn(async () => ({
      status: 'ready' as const,
      sharedSimulation: buildSharedSimulation({
        authoring: {
          source: 'ai-guided',
          briefPreview: 'Create a coral investigation',
          createdAt: '2026-04-20T00:00:00.000Z',
        },
      }),
    }));

    const { MiroFishManagerDialog } = await import('@/components/mirofish/mirofish-manager-dialog');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoots.push({ root, container });

    await act(async () => {
      root.render(
        createElement(MiroFishManagerDialog, {
          open: true,
          onOpenChange,
          sharedSimulation: null,
          participants: [],
          collaboration: null,
          multiUserEnabled: false,
          authoringAvailable: true,
          classroomContext: {
            stageName: 'Coral Reef Lab',
            currentSceneId: 'scene-1',
            currentSceneTitle: 'Coral salinity lab',
            currentSceneType: 'interactive',
          },
          onAttach: vi.fn(async () => {}),
          onGeneratePlan,
          onCreateWithAI,
          onPollCreateJob,
          onGrantControl: vi.fn(async () => {}),
          onRevokeControl: vi.fn(async () => {}),
          onCollaborationAction: vi.fn(async () => {}),
        }),
      );
    });

    await act(async () => {
      findButton(container, 'classroom.mirofish.modeCreate')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    const goalInput = findTextarea(container, 'mirofish-goal');
    const audienceInput = findInput(container, 'mirofish-target-audience');

    await act(async () => {
      if (goalInput) {
        setElementValue(goalInput, 'Create a coral investigation about salinity changes.');
      }
      if (audienceInput) {
        setElementValue(audienceInput, 'Grade 8 science');
      }
    });

    await act(async () => {
      findButton(container, 'classroom.mirofish.generatePlanButton')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    await act(async () => {
      findButton(container, 'classroom.mirofish.createAndAttachButton')?.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });

    expect(onCreateWithAI).toHaveBeenCalledWith({
      spec: expect.objectContaining({
        title: 'Coral Investigation',
      }),
    });
    expect(onPollCreateJob).toHaveBeenCalledWith('job-1');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
