// @vitest-environment jsdom

import {
  act,
  createElement,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ClassroomGameSessionPayload,
  ClassroomGameSessionPlayer,
} from '@/lib/types/classroom-game-session';

vi.mock('@/components/ui/button', async () => {
  const React = await import('react');
  return {
    Button: ({
      children,
      ...props
    }: ButtonHTMLAttributes<HTMLButtonElement> & { children?: ReactNode }) =>
      React.createElement('button', props, children),
  };
});

vi.mock('@/components/ui/badge', async () => {
  const React = await import('react');
  return {
    Badge: ({ children, ...props }: HTMLAttributes<HTMLSpanElement> & { children?: ReactNode }) =>
      React.createElement('span', props, children),
  };
});

vi.mock('@/components/ui/collapsible', async () => {
  const React = await import('react');
  const Shell = ({ children }: { children?: ReactNode }) =>
    React.createElement('div', null, children);
  return {
    Collapsible: Shell,
    CollapsibleContent: Shell,
    CollapsibleTrigger: ({
      children,
      asChild: _asChild,
    }: {
      children?: ReactNode;
      asChild?: boolean;
    }) => React.createElement(React.Fragment, null, children),
  };
});

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildPlayer(
  sessionId: string,
  overrides: Partial<ClassroomGameSessionPlayer> = {},
): ClassroomGameSessionPlayer {
  return {
    sessionId,
    userId: `user-${sessionId}`,
    displayName: sessionId,
    role: 'student',
    ready: false,
    score: 0,
    progress: 0,
    completed: false,
    bridgeReady: true,
    eligible: true,
    late: false,
    lastEventAt: '2026-05-12T00:00:00.000Z',
    lastSeenAt: '2026-05-12T00:00:00.000Z',
    ...overrides,
  };
}

function buildPayload(
  overrides: Partial<ClassroomGameSessionPayload> = {},
): ClassroomGameSessionPayload {
  const player = buildPlayer('Student One', {
    sessionId: 'student-1',
    displayName: 'Student One',
    ready: true,
    score: 25,
    progress: 50,
  });
  return {
    classroomId: 'room-1',
    roundId: 'round-1',
    roundNumber: 1,
    mode: 'both',
    status: 'arming',
    pausedStatus: null,
    controllerSessionId: null,
    latestSharedState: null,
    eligibleSessionIds: ['student-1', 'student-2'],
    armedAt: '2026-05-12T00:00:00.000Z',
    autoStartAt: '2026-05-12T00:00:45.000Z',
    liveStartedAt: null,
    autoEndAt: null,
    pausedAt: null,
    players: { 'student-1': player },
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    roomVersion: 1,
    participantCount: 2,
    participants: [player, buildPlayer('student-2', { displayName: 'Student Two' })],
    leaderboard: [player],
    viewerSessionId: 'teacher-session',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanManage: true,
    viewerCanSubmit: true,
    viewerIsController: false,
    multiplayerSupported: true,
    eligibleCount: 2,
    readyCount: 1,
    readyThreshold: 2,
    completedCount: 0,
    completionThreshold: 2,
    viewerIsLate: false,
    phaseEndsAt: '2026-05-12T00:00:45.000Z',
    phaseRemainingMs: 45_000,
    serverNow: '2026-05-12T00:00:00.000Z',
    ...overrides,
  };
}

async function renderPanel(state: ClassroomGameSessionPayload) {
  const { GameMultiplayerPanel } = await import('@/components/stage/game-multiplayer-panel');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });
  const onTeacherAction = vi.fn();
  const onStudentReady = vi.fn();

  await act(async () => {
    root.render(
      createElement(GameMultiplayerPanel, {
        state,
        onTeacherAction,
        onStudentReady,
      }),
    );
  });

  return { container, onTeacherAction, onStudentReady };
}

describe('GameMultiplayerPanel', () => {
  beforeEach(() => {
    vi.resetModules();
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

  it('renders the teacher race dock with start-now pacing and shared-control drawer', async () => {
    const { container, onTeacherAction } = await renderPanel(buildPayload());

    expect(container.textContent).toContain('Arming');
    expect(container.textContent).toContain('Starts in');
    expect(container.textContent).toContain('0:45');
    expect(container.textContent).toContain('1/2');
    expect(container.textContent).toContain('Start now');
    expect(container.textContent).toContain('Shared control');
    expect(container.textContent).toContain('Student One');

    const startNow = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Start now'),
    );
    await act(async () => {
      startNow?.click();
    });

    expect(onTeacherAction).toHaveBeenCalledWith('start_now', undefined);
  });

  it('marks inactive players while preserving their leaderboard score', async () => {
    const activePlayer = buildPlayer('student-active', {
      displayName: 'Ada Lovelace With A Very Long Display Name',
      score: 25,
      progress: 50,
    });
    const inactivePlayer = buildPlayer('student-inactive', {
      displayName: 'Grace Hopper',
      active: false,
      score: 90,
      progress: 100,
      completed: true,
    });
    const { container } = await renderPanel(
      buildPayload({
        status: 'live',
        roundId: 'round-1',
        roundNumber: 1,
        participantCount: 1,
        players: {
          [activePlayer.sessionId]: activePlayer,
          [inactivePlayer.sessionId]: inactivePlayer,
        },
        participants: [activePlayer, inactivePlayer],
        leaderboard: [inactivePlayer, activePlayer],
        multiplayerSupported: true,
      }),
    );

    expect(container.textContent).toContain('Grace Hopper · inactive');
    expect(container.textContent).toContain('90 · 100%');
    expect(container.textContent).toContain('1/2');
    expect(
      container.querySelector<HTMLButtonElement>(
        'button[aria-label="Inactive player Grace Hopper"]',
      )?.disabled,
    ).toBe(true);
  });

  it('summarizes multiplayer round review details for teachers', async () => {
    const completedPlayer = buildPlayer('student-complete', {
      displayName: 'Ada Lovelace',
      score: 90,
      progress: 100,
      completed: true,
    });
    const stuckPlayer = buildPlayer('student-stuck', {
      displayName: 'Grace Hopper',
      score: 20,
      progress: 40,
      completed: false,
    });
    const nearlyDonePlayer = buildPlayer('student-nearly-done', {
      displayName: 'Katherine Johnson',
      score: 60,
      progress: 80,
      completed: false,
    });
    const inactivePlayer = buildPlayer('student-inactive', {
      displayName: 'Inactive Reviewer',
      active: false,
      score: 99,
      progress: 0,
      completed: false,
    });
    const { container } = await renderPanel(
      buildPayload({
        status: 'completed',
        roundId: 'round-1',
        roundNumber: 1,
        participantCount: 3,
        players: {
          [completedPlayer.sessionId]: completedPlayer,
          [stuckPlayer.sessionId]: stuckPlayer,
          [nearlyDonePlayer.sessionId]: nearlyDonePlayer,
          [inactivePlayer.sessionId]: inactivePlayer,
        },
        participants: [completedPlayer, stuckPlayer, nearlyDonePlayer, inactivePlayer],
        leaderboard: [inactivePlayer, completedPlayer, nearlyDonePlayer, stuckPlayer],
        multiplayerSupported: true,
        eligibleCount: 3,
        readyCount: 3,
        completedCount: 1,
        completionThreshold: 3,
        readyThreshold: 3,
      }),
    );

    const reviewPanel = container.querySelector('[data-testid="multiplayer-round-review"]');
    expect(reviewPanel?.textContent).toContain('Round review');
    expect(reviewPanel?.textContent).toContain('Ready to debrief');
    expect(reviewPanel?.textContent).toContain('Completed1/3');
    expect(reviewPanel?.textContent).toContain('Ready3/3');
    expect(reviewPanel?.textContent).toContain('Avg progress73%');
    expect(reviewPanel?.textContent).toContain('Top score99');
    expect(reviewPanel?.textContent).toContain('Grace Hopper, Katherine Johnson');
    expect(reviewPanel?.textContent).not.toContain('Inactive Reviewer');
    expect(container.textContent).toContain('Arm round');
  });

  it('renders student score, rank, and late join state', async () => {
    const latePlayer = buildPlayer('student-late', {
      displayName: 'Late Student',
      score: 10,
      progress: 20,
      late: true,
      eligible: false,
    });
    const { container, onStudentReady } = await renderPanel(
      buildPayload({
        status: 'live',
        viewerCanManage: false,
        viewerSessionId: 'student-late',
        viewerRole: 'student',
        viewerKind: 'classroom',
        players: { 'student-late': latePlayer },
        participants: [latePlayer],
        leaderboard: [latePlayer],
        viewerIsLate: true,
        readyCount: 2,
        completedCount: 1,
        phaseRemainingMs: 120_000,
      }),
    );

    expect(container.textContent).toContain('Late join');
    expect(container.textContent).toContain('Score 10');
    expect(container.textContent).toContain('Progress 20%');
    expect(container.textContent).toContain('Rank 1');

    const readyButton = [...container.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Mark ready'),
    );
    await act(async () => {
      readyButton?.click();
    });

    expect(onStudentReady).toHaveBeenCalledTimes(1);
  });
});
