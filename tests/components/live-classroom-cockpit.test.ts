// @vitest-environment jsdom

import {
  act,
  createElement,
  type AnchorHTMLAttributes,
  type ButtonHTMLAttributes,
  type ComponentProps,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveClassroomApprovalItem } from '@/lib/utils/live-classroom-cockpit';

vi.mock('@/lib/hooks/use-i18n', () => ({
  useI18n: () => ({
    t: (key: string) =>
      ({
        'classroom.liveMeeting.joinZoom': 'Join Zoom',
      })[key] ?? key,
  }),
}));

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

vi.mock('@/components/ui/badge', async () => {
  const React = await import('react');
  return {
    Badge: ({ children, ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) =>
      React.createElement('span', props, children),
  };
});

vi.mock('@/components/ui/textarea', async () => {
  const React = await import('react');
  return {
    Textarea: (props: TextareaHTMLAttributes<HTMLTextAreaElement>) =>
      React.createElement('textarea', props),
  };
});

vi.mock('@/components/ui/separator', async () => {
  const React = await import('react');
  return {
    Separator: () => React.createElement('hr'),
  };
});

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

async function mountCockpit(
  initialOverrides: Partial<
    ComponentProps<typeof import('@/components/stage/live-classroom-cockpit').LiveClassroomCockpit>
  > = {},
) {
  const { LiveClassroomCockpit } = await import('@/components/stage/live-classroom-cockpit');

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  const approval: LiveClassroomApprovalItem = {
    id: 'prompt-recap-scene-1',
    type: 'teacher_prompt',
    summary: 'Ask for a quick recap',
    preview: 'Have the AI teacher recap this idea in simpler language.',
    action: {
      kind: 'teacher-prompt',
      prompt: 'Recap this scene simply.',
    },
  };

  const props: ComponentProps<typeof LiveClassroomCockpit> = {
    open: true,
    onOpenChange: vi.fn(),
    currentSceneTitle: 'Energy Transfer',
    currentSceneNumber: 2,
    totalScenesCount: 5,
    previousScene: { id: 'scene-1', title: 'Warm-up' },
    nextScene: { id: 'scene-3', title: 'Lab' },
    activeSurfaceLabel: 'Lesson',
    activeSurface: 'lesson',
    simulationAvailable: true,
    whiteboardOpen: false,
    studentCount: 2,
    handRaiseCount: 0,
    helpCount: 1,
    pendingApprovalCount: 1,
    approvalItems: [approval],
    participants: [
      {
        sessionId: 'student-1',
        userId: 'student-1',
        displayName: 'Student One',
        role: 'student',
        lastSeenAt: new Date().toISOString(),
        isController: true,
      },
    ],
    controllerDisplayName: 'Student One',
    viewerCanControlPresentation: true,
    viewerCanManageSimulation: true,
    classPaused: false,
    ttsMuted: false,
    autoPlayEnabled: true,
    promptsLocked: false,
    reportAvailable: true,
    onTogglePause: vi.fn(),
    onPreviousScene: vi.fn(),
    onNextScene: vi.fn(),
    onReplayScene: vi.fn(),
    onSelectScene: vi.fn(),
    onSetPresentationSurface: vi.fn(),
    onToggleWhiteboard: vi.fn(),
    onOpenAdvancedControls: vi.fn(),
    onTogglePromptsLock: vi.fn(),
    onToggleNarrationMute: vi.fn(),
    onToggleAutoPlay: vi.fn(),
    onRecoverToLesson: vi.fn(),
    onApproveApproval: vi.fn(),
    onRejectApproval: vi.fn(),
    onEditApproval: vi.fn(),
    onSendTeacherPrompt: vi.fn(),
    ...initialOverrides,
  };

  await act(async () => {
    root.render(createElement(LiveClassroomCockpit, props));
  });

  return { container, props, approval };
}

describe('LiveClassroomCockpit', () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
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

  it('renders live classroom status and approval controls', async () => {
    const { container, props, approval } = await mountCockpit();

    expect(container.textContent).toContain('Live Classroom Cockpit');
    expect(container.textContent).toContain('Energy Transfer');
    expect(container.textContent).toContain('2 students');
    expect(container.textContent).toContain('Ask for a quick recap');

    const approveButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Approve'),
    );
    expect(approveButton).toBeTruthy();

    await act(async () => {
      approveButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(props.onApproveApproval).toHaveBeenCalledWith(approval);
  });

  it('supports editing approval prompts and sending quick interventions', async () => {
    const { container, props, approval } = await mountCockpit();

    const editButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Edit'),
    );
    expect(editButton).toBeTruthy();

    await act(async () => {
      editButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    const recapTextarea = Array.from(container.querySelectorAll('textarea')).find((textarea) =>
      textarea.value.includes('Recap this scene simply.'),
    );
    expect(recapTextarea).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(recapTextarea, 'Slow down and recap the scene in one sentence.');
      recapTextarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendEditedButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Send edited'),
    );
    expect(sendEditedButton).toBeTruthy();

    await act(async () => {
      sendEditedButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(props.onEditApproval).toHaveBeenCalledWith(
      approval,
      'Slow down and recap the scene in one sentence.',
    );

    const interventionTextarea = Array.from(container.querySelectorAll('textarea')).find(
      (textarea) => textarea.placeholder?.includes('Ask the AI teacher'),
    );
    expect(interventionTextarea).toBeTruthy();

    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(
        HTMLTextAreaElement.prototype,
        'value',
      )?.set;
      valueSetter?.call(interventionTextarea, 'Ask one reflective question before moving on.');
      interventionTextarea!.dispatchEvent(new Event('input', { bubbles: true }));
    });

    const sendInterventionButton = Array.from(container.querySelectorAll('button')).find((button) =>
      button.textContent?.includes('Send intervention'),
    );
    expect(sendInterventionButton).toBeTruthy();

    await act(async () => {
      sendInterventionButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(props.onSendTeacherPrompt).toHaveBeenCalledWith(
      'Ask one reflective question before moving on.',
    );
  });

  it('renders student activity labels derived from presence state', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-13T00:00:00.000Z'));

    const { container } = await mountCockpit({
      participants: [
        {
          sessionId: 'student-1',
          userId: 'student-1',
          displayName: 'Student One',
          role: 'student',
          lastSeenAt: new Date().toISOString(),
          isController: true,
        },
      ],
    });

    expect(container.textContent).toContain('active');
    expect(container.textContent).toContain('just now');
    vi.useRealTimers();
  });

  it('renders a Zoom join action when a live meeting is attached', async () => {
    const { container } = await mountCockpit({
      liveMeeting: {
        provider: 'zoom',
        source: 'manual-link',
        joinUrl: 'https://zoom.us/j/123456789',
        attachedAt: '2026-04-13T00:00:00.000Z',
        attachedByUserId: 'teacher-1',
      },
    });

    expect(container.textContent).toContain('Join Zoom');
    expect(container.querySelector('a[href="https://zoom.us/j/123456789"]')).toBeTruthy();
  });
});
