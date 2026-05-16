import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomGameSessionPayloadMock = vi.fn();
const getClassroomGameSessionFingerprintMock = vi.fn((payload: unknown) => JSON.stringify(payload));
const listClassroomRoomEventsSinceMock = vi.fn();
const subscribeToClassroomRoomEventsMock = vi.fn();
const touchSessionMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-game-session', () => ({
  getClassroomGameSessionFingerprint: getClassroomGameSessionFingerprintMock,
  getClassroomGameSessionPayload: getClassroomGameSessionPayloadMock,
}));

vi.mock('@/lib/server/classroom-room-events', () => ({
  listClassroomRoomEventsSince: listClassroomRoomEventsSinceMock,
  subscribeToClassroomRoomEvents: subscribeToClassroomRoomEventsMock,
}));

vi.mock('@/lib/db/repositories/sessions', () => ({
  touchSession: touchSessionMock,
}));

const access = {
  auth: {
    session: {
      id: 'student-session',
      kind: 'classroom',
      role: 'student',
      expiresAt: '2099-05-12T18:00:00.000Z',
    },
    user: { id: 'student-1', displayName: 'Ada' },
  },
  source: 'classroom',
};

function payload(overrides: Record<string, unknown> = {}) {
  return {
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
    viewerSessionId: 'student-session',
    viewerRole: 'student',
    viewerKind: 'classroom',
    viewerCanManage: false,
    viewerCanSubmit: true,
    viewerIsController: false,
    multiplayerSupported: false,
    ...overrides,
  };
}

async function readChunk(reader: ReadableStreamDefaultReader<Uint8Array>) {
  const result = await reader.read();
  return new TextDecoder().decode(result.value);
}

describe('/api/classroom/[id]/game-session-events', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    requireClassroomAccessMock.mockReset();
    getClassroomGameSessionPayloadMock.mockReset();
    getClassroomGameSessionFingerprintMock.mockClear();
    listClassroomRoomEventsSinceMock.mockReset();
    subscribeToClassroomRoomEventsMock.mockReset();
    touchSessionMock.mockReset();
    touchSessionMock.mockResolvedValue(undefined);

    requireClassroomAccessMock.mockResolvedValue(access);
    getClassroomGameSessionPayloadMock.mockResolvedValue(payload());
    listClassroomRoomEventsSinceMock.mockResolvedValue([]);
    subscribeToClassroomRoomEventsMock.mockReturnValue(vi.fn());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams the initial state with the latest relevant replay id', async () => {
    listClassroomRoomEventsSinceMock.mockResolvedValue([
      { eventId: 'event-1', kind: 'chat.updated' },
      { eventId: 'event-2', kind: 'game_session.updated' },
    ]);

    const abortController = new AbortController();
    const { GET } = await import('@/app/api/classroom/[id]/game-session-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/game-session-events', {
        headers: { 'Last-Event-ID': 'event-0' },
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const reader = response.body!.getReader();
    const chunk = await readChunk(reader);
    abortController.abort();
    await reader.cancel().catch(() => undefined);

    expect(response.status).toBe(200);
    expect(listClassroomRoomEventsSinceMock).toHaveBeenCalledWith('room-1', 'event-0');
    expect(chunk).toContain('id: event-2');
    expect(chunk).toContain('event: game-session-state');
    expect(touchSessionMock).toHaveBeenCalledWith('student-session', {
      lastSeenAt: expect.any(String),
      expiresAt: '2099-05-12T18:00:00.000Z',
    });
  });

  it('emits heartbeat events and refreshes classroom presence', async () => {
    const abortController = new AbortController();
    const { GET } = await import('@/app/api/classroom/[id]/game-session-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/game-session-events', {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const reader = response.body!.getReader();
    await readChunk(reader);

    const heartbeatPromise = readChunk(reader);
    await vi.advanceTimersByTimeAsync(20_000);
    const heartbeat = await heartbeatPromise;
    abortController.abort();
    await reader.cancel().catch(() => undefined);

    expect(heartbeat).toContain('event: heartbeat');
    expect(touchSessionMock).toHaveBeenCalledTimes(2);
  });

  it('broadcasts room game-session updates', async () => {
    let listener: (event: { kind: string; eventId: string }) => void = () => undefined;
    subscribeToClassroomRoomEventsMock.mockImplementation((_id, callback) => {
      listener = callback;
      return vi.fn();
    });
    getClassroomGameSessionPayloadMock
      .mockResolvedValueOnce(payload())
      .mockResolvedValueOnce(payload({ status: 'live', roundId: 'round-1', roundNumber: 1 }));

    const abortController = new AbortController();
    const { GET } = await import('@/app/api/classroom/[id]/game-session-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/game-session-events', {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const reader = response.body!.getReader();
    await readChunk(reader);

    const updatePromise = readChunk(reader);
    listener?.({ kind: 'game_session.updated', eventId: 'event-live' });
    const update = await updatePromise;
    abortController.abort();
    await reader.cancel().catch(() => undefined);

    expect(update).toContain('id: event-live');
    expect(update).toContain('"status":"live"');
    expect(update).toContain('"roundId":"round-1"');
  });
});
