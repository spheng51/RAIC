// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameMultiplayerPanel } from '@/components/stage/game-multiplayer-panel';
import type {
  ClassroomGameSessionPayload,
  ClassroomGameSessionPlayer,
} from '@/lib/types/classroom-game-session';

const mountedRoots: Array<{ root: Root; container: HTMLDivElement }> = [];

function buildState(
  overrides: Partial<ClassroomGameSessionPayload> = {},
): ClassroomGameSessionPayload {
  return {
    classroomId: 'room-1',
    roundId: null,
    roundNumber: 0,
    mode: 'both',
    status: 'idle',
    controllerSessionId: null,
    latestSharedState: null,
    players: {},
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    participantCount: 0,
    participants: [],
    leaderboard: [],
    viewerSessionId: 'teacher-session',
    viewerRole: 'teacher',
    viewerKind: 'web',
    viewerCanManage: true,
    viewerCanSubmit: false,
    viewerIsController: false,
    multiplayerSupported: false,
    ...overrides,
  };
}

function buildPlayer(
  overrides: Partial<ClassroomGameSessionPlayer> = {},
): ClassroomGameSessionPlayer {
  return {
    sessionId: 'student-session',
    userId: 'student-1',
    displayName: 'Student',
    role: 'student',
    active: true,
    ready: true,
    score: 0,
    progress: 0,
    completed: false,
    bridgeReady: true,
    lastEventAt: '2026-05-12T00:00:01.000Z',
    lastSeenAt: '2026-05-12T00:00:01.000Z',
    ...overrides,
  };
}

async function renderPanel(
  state: ClassroomGameSessionPayload,
  onTeacherAction = vi.fn(),
  onStudentReady = vi.fn(),
) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mountedRoots.push({ root, container });

  await act(async () => {
    root.render(
      <GameMultiplayerPanel
        state={state}
        onTeacherAction={onTeacherAction}
        onStudentReady={onStudentReady}
      />,
    );
  });

  return { container, onTeacherAction, onStudentReady };
}

describe('GameMultiplayerPanel', () => {
  beforeEach(() => {
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

  it('keeps host controls status-aware and collapsible', async () => {
    await renderPanel(buildState());

    expect(document.body.textContent).toContain('Complete');
    expect(document.body.querySelector('button[disabled]')?.textContent).toContain('Pause');

    const collapseButton = Array.from(document.body.querySelectorAll('button')).find(
      (button) => button.getAttribute('aria-label') === 'Collapse multiplayer panel',
    );
    expect(collapseButton).toBeTruthy();

    await act(async () => {
      collapseButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(document.body.textContent).not.toContain('Leaderboard');
  });

  it('marks inactive players while preserving their leaderboard score', async () => {
    const activePlayer = buildPlayer({
      sessionId: 'student-active',
      userId: 'student-1',
      displayName: 'Ada Lovelace With A Very Long Display Name',
      score: 25,
      progress: 50,
    });
    const inactivePlayer = buildPlayer({
      sessionId: 'student-inactive',
      userId: 'student-2',
      displayName: 'Grace Hopper',
      active: false,
      score: 90,
      progress: 100,
      completed: true,
    });

    await renderPanel(
      buildState({
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

    expect(document.body.textContent).toContain('Grace Hopper · inactive');
    expect(document.body.textContent).toContain('90 · 100%');
    expect(document.body.textContent).toContain('1/2');
  });

  it('summarizes multiplayer round review details for teachers', async () => {
    const completedPlayer = buildPlayer({
      sessionId: 'student-complete',
      displayName: 'Ada Lovelace',
      score: 90,
      progress: 100,
      completed: true,
    });
    const stuckPlayer = buildPlayer({
      sessionId: 'student-stuck',
      displayName: 'Grace Hopper',
      score: 20,
      progress: 40,
      completed: false,
    });
    const nearlyDonePlayer = buildPlayer({
      sessionId: 'student-nearly-done',
      displayName: 'Katherine Johnson',
      score: 60,
      progress: 80,
      completed: false,
    });
    const inactivePlayer = buildPlayer({
      sessionId: 'student-inactive',
      displayName: 'Inactive Reviewer',
      active: false,
      score: 99,
      progress: 0,
      completed: false,
    });

    await renderPanel(
      buildState({
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
      }),
    );

    const reviewPanel = document.body.querySelector('[data-testid="multiplayer-round-review"]');
    expect(reviewPanel?.textContent).toContain('Round review');
    expect(reviewPanel?.textContent).toContain('Ready to debrief');
    expect(reviewPanel?.textContent).toContain('Completed1/3');
    expect(reviewPanel?.textContent).toContain('Ready3/3');
    expect(reviewPanel?.textContent).toContain('Avg progress73%');
    expect(reviewPanel?.textContent).toContain('Top score99');
    expect(reviewPanel?.textContent).toContain('Grace Hopper, Katherine Johnson');
    expect(reviewPanel?.textContent).not.toContain('Inactive Reviewer');
    expect(document.body.textContent).toContain('Start next round');
  });
});
