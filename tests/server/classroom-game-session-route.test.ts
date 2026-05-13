import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomGameSessionPayloadMock = vi.fn();
const readClassroomGameSessionStateMock = vi.fn();
const updateClassroomGameSessionStateMock = vi.fn();
const recordClassroomRoomEventMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-game-session', () => ({
  canSessionManageGameSession: (session: { kind: string; role: string }) =>
    session.kind === 'web' && session.role !== 'student',
  canSessionSubmitGameEvent: vi.fn(() => true),
  getClassroomGameSessionPayload: getClassroomGameSessionPayloadMock,
  readClassroomGameSessionState: readClassroomGameSessionStateMock,
  startNewGameRound: (state: object) => ({
    ...state,
    roundId: 'round-1',
    roundNumber: 1,
    status: 'live',
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
  controllerSessionId: null,
  latestSharedState: null,
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
};

describe('/api/classroom/[id]/game-session', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomGameSessionPayloadMock.mockReset();
    readClassroomGameSessionStateMock.mockReset();
    updateClassroomGameSessionStateMock.mockReset();
    recordClassroomRoomEventMock.mockReset();
    getClassroomGameSessionPayloadMock.mockResolvedValue(payload);
    readClassroomGameSessionStateMock.mockResolvedValue(payload);
    updateClassroomGameSessionStateMock.mockImplementation(async (_id, updater) =>
      updater({
        ...payload,
        players: {},
      }),
    );
  });

  it('returns access failures directly', async () => {
    requireClassroomAccessMock.mockResolvedValue(
      NextResponse.json({ success: false, error: 'Classroom access required' }, { status: 401 }),
    );

    const { GET } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await GET(new NextRequest('http://localhost/api/classroom/room-1/game-session'), {
      params: Promise.resolve({ id: 'room-1' }),
    });

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
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ classroomId: 'room-1', kind: 'game_session.updated' }),
    );
  });

  it('allows students to submit score progress', async () => {
    requireClassroomAccessMock.mockResolvedValue(studentAccess);

    const { POST } = await import('@/app/api/classroom/[id]/game-session/route');
    const response = await POST(
      new NextRequest('http://localhost/api/classroom/room-1/game-session', {
        method: 'POST',
        body: JSON.stringify({ event: 'score', score: 42, progress: 80 }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(updateClassroomGameSessionStateMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ event: 'score', score: 42, progress: 80 }),
      }),
    );
  });
});
