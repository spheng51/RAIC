import { beforeEach, describe, expect, it, vi } from 'vitest';

const readClassroomMock = vi.fn();
const listRecentClassroomSessionsMock = vi.fn();
const findUserByIdMock = vi.fn();

vi.mock('@/lib/server/classroom-storage', () => ({
  readClassroom: readClassroomMock,
}));

vi.mock('@/lib/db/repositories/sessions', () => ({
  listRecentClassroomSessions: listRecentClassroomSessionsMock,
}));

vi.mock('@/lib/db/repositories/users', () => ({
  findUserById: findUserByIdMock,
}));

vi.mock('@/lib/server/mirofish', () => ({
  isMiroFishMultiUserEnabled: () => true,
  withMiroFishEmbedToken: (url: string) => url,
}));

describe('classroom snapshot normalization', () => {
  beforeEach(() => {
    vi.resetModules();
    readClassroomMock.mockReset();
    listRecentClassroomSessionsMock.mockReset();
    findUserByIdMock.mockReset();
    findUserByIdMock.mockResolvedValue({ displayName: 'Student One' });
    listRecentClassroomSessionsMock.mockResolvedValue([
      {
        id: 'student-session',
        userId: 'student-1',
        role: 'student',
        kind: 'classroom',
        lastSeenAt: '2026-04-20T00:00:00.000Z',
      },
    ]);
  });

  it('recomputes presentation controller flags after normalization resets expired control', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      roomVersion: 1,
      stage: {
        id: 'room-1',
        name: 'Room 1',
        createdAt: 1,
        updatedAt: 1,
        sharedSimulation: {
          provider: 'mirofish',
          simulationId: 'sim-1',
          runUrl: 'https://mirofish.example/run',
          activeSurface: 'simulation',
          controllerRole: 'student',
          controllerSessionId: 'student-session',
          controlLeaseExpiresAt: '2000-01-01T00:00:00.000Z',
          status: 'running',
        },
      },
      scenes: [],
    });

    const { getClassroomPresentationSnapshot } = await import('@/lib/server/classroom-presentation');
    const snapshot = await getClassroomPresentationSnapshot('room-1');

    expect(snapshot?.sharedSimulation?.controllerRole).toBe('teacher');
    expect(snapshot?.sharedSimulation?.controllerSessionId).toBeUndefined();
    expect(snapshot?.participants).toEqual([
      expect.objectContaining({
        sessionId: 'student-session',
        isController: false,
      }),
    ]);
  });

  it('recomputes collaboration interaction flags after normalization resets expired control', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      roomVersion: 1,
      stage: {
        id: 'room-1',
        name: 'Room 1',
        createdAt: 1,
        updatedAt: 1,
        sharedSimulation: {
          provider: 'mirofish',
          simulationId: 'sim-1',
          runUrl: 'https://mirofish.example/run',
          activeSurface: 'simulation',
          controllerRole: 'student',
          controllerSessionId: 'student-session',
          controlLeaseExpiresAt: '2000-01-01T00:00:00.000Z',
          status: 'running',
        },
      },
      scenes: [],
    });

    const { getClassroomCollaborationSnapshot } = await import(
      '@/lib/server/classroom-collaboration'
    );
    const snapshot = await getClassroomCollaborationSnapshot('room-1');

    expect(snapshot?.sharedSimulation?.controllerRole).toBe('teacher');
    expect(snapshot?.sharedSimulation?.controllerSessionId).toBeUndefined();
    expect(snapshot?.participants).toEqual([
      expect.objectContaining({
        sessionId: 'student-session',
        canInteract: false,
      }),
    ]);
  });
});
