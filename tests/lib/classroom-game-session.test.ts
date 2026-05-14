import { describe, expect, it, vi } from 'vitest';
import type {
  ClassroomGameSessionPlayer,
  ClassroomGameSessionState,
} from '@/lib/types/classroom-game-session';

vi.mock('server-only', () => ({}));

const now = new Date('2026-05-12T00:00:00.000Z');

function buildState(overrides: Partial<ClassroomGameSessionState> = {}): ClassroomGameSessionState {
  return {
    classroomId: 'room-1',
    roundId: null,
    roundNumber: 0,
    mode: 'both',
    status: 'idle',
    pausedStatus: null,
    controllerSessionId: null,
    latestSharedState: null,
    eligibleSessionIds: [],
    armedAt: null,
    autoStartAt: null,
    liveStartedAt: null,
    autoEndAt: null,
    pausedAt: null,
    players: {},
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    ...overrides,
  };
}

function buildPlayer(id: string, overrides: Partial<ClassroomGameSessionPlayer> = {}) {
  return {
    sessionId: id,
    userId: `user-${id}`,
    displayName: id,
    role: 'student',
    ready: false,
    score: 0,
    progress: 0,
    completed: false,
    bridgeReady: true,
    eligible: true,
    late: false,
    lastEventAt: now.toISOString(),
    lastSeenAt: now.toISOString(),
    ...overrides,
  };
}

describe('classroom game session lifecycle', () => {
  it('arms a fresh round with eligible players and a 45 second ready window', async () => {
    const { GAME_ROUND_READY_COUNTDOWN_MS, startNewGameRound } =
      await import('@/lib/server/classroom-game-session');
    const round = startNewGameRound(
      buildState(),
      [buildPlayer('student-1'), buildPlayer('student-2')],
      now,
    );

    expect(round).toMatchObject({
      roundNumber: 1,
      status: 'arming',
      eligibleSessionIds: ['student-1', 'student-2'],
      armedAt: now.toISOString(),
      autoStartAt: new Date(now.getTime() + GAME_ROUND_READY_COUNTDOWN_MS).toISOString(),
      liveStartedAt: null,
      autoEndAt: null,
    });
    expect(round.players['student-1']).toMatchObject({
      ready: false,
      score: 0,
      progress: 0,
      eligible: true,
      late: false,
    });
  });

  it('auto-starts when the 80 percent ready threshold is met', async () => {
    const { GAME_ROUND_DURATION_MS, advanceGameSessionState } =
      await import('@/lib/server/classroom-game-session');
    const state = buildState({
      roundId: 'round-1',
      roundNumber: 1,
      status: 'arming',
      eligibleSessionIds: ['student-1', 'student-2', 'student-3'],
      autoStartAt: new Date(now.getTime() + 45_000).toISOString(),
      players: {
        'student-1': buildPlayer('student-1', { ready: true }),
        'student-2': buildPlayer('student-2', { ready: true }),
        'student-3': buildPlayer('student-3', { ready: true }),
      },
    });

    const advanced = advanceGameSessionState(state, now);

    expect(advanced.status).toBe('live');
    expect(advanced.liveStartedAt).toBe(now.toISOString());
    expect(advanced.autoEndAt).toBe(new Date(now.getTime() + GAME_ROUND_DURATION_MS).toISOString());
  });

  it('auto-completes live rounds by timer or eligible completion majority', async () => {
    const { advanceGameSessionState } = await import('@/lib/server/classroom-game-session');
    const live = buildState({
      roundId: 'round-1',
      roundNumber: 1,
      status: 'live',
      eligibleSessionIds: ['student-1', 'student-2', 'student-3'],
      liveStartedAt: now.toISOString(),
      autoEndAt: new Date(now.getTime() + 300_000).toISOString(),
      players: {
        'student-1': buildPlayer('student-1', { completed: true }),
        'student-2': buildPlayer('student-2', { completed: true }),
        'student-3': buildPlayer('student-3', { completed: true }),
        'late-student': buildPlayer('late-student', {
          completed: true,
          eligible: false,
          late: true,
        }),
      },
    });

    expect(advanceGameSessionState(live, now).status).toBe('completed');

    const expired = {
      ...live,
      players: {
        'student-1': buildPlayer('student-1'),
        'student-2': buildPlayer('student-2'),
        'student-3': buildPlayer('student-3'),
      },
    };
    expect(advanceGameSessionState(expired, new Date(now.getTime() + 300_001)).status).toBe(
      'completed',
    );
  });

  it('only accepts gameplay and shared-control events during the right live states', async () => {
    const { canSessionSubmitGameEvent } = await import('@/lib/server/classroom-game-session');
    const student = {
      id: 'student-1',
      kind: 'classroom',
      role: 'student',
    };
    const live = buildState({
      roundId: 'round-1',
      status: 'live',
      mode: 'both',
      controllerSessionId: 'student-1',
    });

    expect(
      canSessionSubmitGameEvent(buildState({ status: 'idle' }), student as never, 'score'),
    ).toBe(false);
    expect(
      canSessionSubmitGameEvent(buildState({ status: 'arming' }), student as never, 'ready'),
    ).toBe(true);
    expect(canSessionSubmitGameEvent(live, student as never, 'score')).toBe(true);
    expect(canSessionSubmitGameEvent(live, student as never, 'control_input')).toBe(true);
    expect(
      canSessionSubmitGameEvent(
        { ...live, mode: 'leaderboard' },
        student as never,
        'control_input',
      ),
    ).toBe(false);
    expect(
      canSessionSubmitGameEvent({ ...live, status: 'paused' }, student as never, 'score'),
    ).toBe(false);
    expect(canSessionSubmitGameEvent(buildState(), student as never, 'bridge_ready')).toBe(true);
  });
});
