import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomGameSessionPayloadMock = vi.fn();
const updateClassroomGameSessionStateMock = vi.fn();
const recordClassroomRoomEventMock = vi.fn();
const canSessionSubmitGameEventMock = vi.fn(() => true);

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-game-session', () => ({
  advanceGameSessionState: (state: object) => state,
  completeGameRound: (state: object) => ({ ...state, status: 'completed' }),
  canSessionManageGameSession: (session: { kind: string; role: string }) =>
    session.kind === 'web' && session.role !== 'student',
  canSessionSubmitGameEvent: canSessionSubmitGameEventMock,
  getClassroomGameSessionPayload: getClassroomGameSessionPayloadMock,
  pauseGameRound: (state: object) => ({ ...state, status: 'paused' }),
  resetGameRound: (state: object) => ({ ...state, roundId: null, status: 'idle', players: {} }),
  resumeGameRound: (state: object) => ({ ...state, status: 'live' }),
  startLiveGameRound: (state: object) => ({ ...state, status: 'live' }),
  startNewGameRound: (state: object, eligiblePlayers: Array<{ sessionId: string }>) => ({
    ...state,
    roundId: 'round-1',
    roundNumber: 1,
    status: 'arming',
    eligibleSessionIds: eligiblePlayers.map((player) => player.sessionId),
  }),
  updateClassroomGameSessionState: updateClassroomGameSessionStateMock,
}));

vi.mock('@/lib/server/classroom-room-events', () => ({
  buildClassroomRoomEventActor: (input: unknown) => input,
  recordClassroomRoomEvent: recordClassroomRoomEventMock,
}));

const teacherAccess = {
  auth: {
    session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
    user: { id: 'teacher-1', displayName: 'Teacher' },
  },
  source: 'web',
};

const studentAccess = {
  auth: {
    session: { id: 'student-session', kind: 'classroom', role: 'student' },
    user: { id: 'student-1', displayName: 'Ada' },
  },
  source: 'classroom',
};

const payload = {
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
  createdAt: '2026-05-11T00:00:00.000Z',
  updatedAt: '2026-05-11T00:00:00.000Z',
  participantCount: 0,
  participants: [],
  leaderboard: [],
  viewerSessionId: 'teacher-session',
  viewerRole: 'teacher',
  viewerKind: 'web',
  viewerCanManage: true,
  viewerCanSubmit: true,
  viewerIsController: false,
  multiplayerSupported: true,
  eligibleCount: 0,
  readyCount: 0,
  readyThreshold: 0,
  completedCount: 0,
  completionThreshold: 0,
  viewerIsLate: false,
  phaseEndsAt: null,
  phaseRemainingMs: null,
  serverNow: '2026-05-11T00:00:00.000Z',
};

let currentGameSessionState: Record<string, unknown>;

function setCurrentGameSessionState(overrides: Record<string, unknown> = {}) {
  currentGameSessionState = {
    ...payload,
    players: {},
    ...overrides,
  };
}

describe('/api/classroom/[id]/game-session', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomGameSessionPayloadMock.mockReset();
    updateClassroomGameSessionStateMock.mockReset();
    recordClassroomRoomEventMock.mockReset();
    canSessionSubmitGameEventMock.mockReset();
    canSessionSubmitGameEventMock.mockReturnValue(true);
    getClassroomGameSessionPayloadMock.mockResolvedValue(payload);
    setCurrentGameSessionState();
    updateClassroomGameSessionStateMock.mockImplementation(async (_id, updater) =>
      updater(currentGameSessionState),
    );
  });

  it('returns access failures directly', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json({ success: false, error: 'Classroom access required' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/game-session'),
      {
        params: Promise.resolve({ id: 'room-1' }),
      },
    );

    expect(response.status).toBe(401);
    expect(getClassroomGameSessionPayloadMock).not.toHaveBeenCalled();
  });

  it('allows teachers to start a round', async () => {
    requireClassroomAccessMock.mockResolvedValue(teacherAccess);

    const { PATCH } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'PATCH',
        body: JSON.stringify({ action: 'start_round' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ classroomId: 'room-1', kind: 'game_session.updated' }),
    );
  });

  it('allows students to submit score progress during live rounds', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    setCurrentGameSessionState({
      roundId: 'round-1',
      status: 'live',
    });
    getClassroomGameSessionPayloadMock.mockResolvedValue({
      ...payload,
      status: 'live',
      roundId: 'round-1',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'score', roundId: 'round-1', score: 42, progress: 80 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ event: 'score', score: 42, progress: 80 }),
      }),
    );
  });

  it('rejects score progress when the session guard disallows it', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    canSessionSubmitGameEventMock.mockReturnValue(false);
    setCurrentGameSessionState({
      roundId: 'round-1',
      status: 'live',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'score', roundId: 'round-1', score: 42, progress: 80 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(recordClassroomRoomEventMock).not.toHaveBeenCalled();
  });

  it('rejects score progress while the round is not live', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    setCurrentGameSessionState({
      roundId: 'round-1',
      status: 'paused',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'score', roundId: 'round-1', score: 42, progress: 80 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe('Game events can only update the round while it is live.');
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(recordClassroomRoomEventMock).not.toHaveBeenCalled();
  });

  it('allows readiness before live play without applying round score progress', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    let updatedPlayer:
      | {
          ready: boolean;
          score: number;
          progress: number;
        }
      | undefined;
    updateClassroomGameSessionStateMock.mockImplementationOnce(async (_id, updater) => {
      const updatedState = updater({ ...payload, players: {} });
      updatedPlayer = updatedState.players['student-session'];
      return updatedState;
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'ready', score: 42, progress: 80 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updatedPlayer).toMatchObject({
      ready: true,
      score: 0,
      progress: 0,
    });
  });

  it('rejects stale round events', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    setCurrentGameSessionState({
      roundId: 'round-current',
      status: 'live',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'progress', roundId: 'round-old', progress: 20 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe('This game event belongs to a stale round.');
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(recordClassroomRoomEventMock).not.toHaveBeenCalled();
  });

  it('rejects live round events that omit the current round id', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    setCurrentGameSessionState({
      roundId: 'round-current',
      status: 'live',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'progress', progress: 20 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(409);
    expect(json.error).toBe('This game event is missing a round id.');
    expect(updateClassroomGameSessionStateMock).not.toHaveBeenCalled();
    expect(recordClassroomRoomEventMock).not.toHaveBeenCalled();
  });

  it('rejects oversized game event payloads', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    setCurrentGameSessionState({
      roundId: 'round-1',
      status: 'live',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'shared_state', state: { blob: 'x'.repeat(17_000) } }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(413);
    expect(updateClassroomGameSessionStateMock).not.toHaveBeenCalled();
    expect(recordClassroomRoomEventMock).not.toHaveBeenCalled();
  });

  it('rejects non-controller shared-control submissions', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);
    canSessionSubmitGameEventMock.mockReturnValue(false);
    setCurrentGameSessionState({
      roundId: 'round-1',
      status: 'live',
      mode: 'shared-control',
      controllerSessionId: 'other-student',
    });

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'control_input', roundId: 'round-1', input: { x: 1 } }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(403);
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith(
      'room-1',
      expect.any(Function),
    );
    expect(recordClassroomRoomEventMock).not.toHaveBeenCalled();
  });
});
