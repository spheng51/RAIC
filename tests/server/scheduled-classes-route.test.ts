import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const listScheduledClassesForAccessMock = vi.fn();
const createScheduledClassForAccessMock = vi.fn();
const updateScheduledClassForAccessMock = vi.fn();
const deleteScheduledClassForAccessMock = vi.fn();
const readClassroomMock = vi.fn();

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/server/scheduled-classes', () => ({
  listScheduledClassesForAccess: listScheduledClassesForAccessMock,
  createScheduledClassForAccess: createScheduledClassForAccessMock,
  updateScheduledClassForAccess: updateScheduledClassForAccessMock,
  deleteScheduledClassForAccess: deleteScheduledClassForAccessMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    readClassroom: readClassroomMock,
  };
});

vi.mock('@/lib/logger', () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const authContext = {
  session: {
    id: 'teacher-session',
    kind: 'web',
    role: 'teacher',
    organizationId: 'org-1',
  },
  user: { id: 'teacher-1' },
};

const scope = {
  role: 'teacher',
  userId: 'teacher-1',
  organizationId: 'org-1',
};

describe('/api/scheduled-classes', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    listScheduledClassesForAccessMock.mockReset();
    createScheduledClassForAccessMock.mockReset();
    updateScheduledClassForAccessMock.mockReset();
    deleteScheduledClassForAccessMock.mockReset();
    readClassroomMock.mockReset();

    requireRequestRoleMock.mockResolvedValue(authContext);
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      stage: { id: 'room-1', name: 'Physics' },
      scenes: [],
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
  });

  it('lists scheduled classes for the current teacher scope', async () => {
    listScheduledClassesForAccessMock.mockResolvedValue([
      {
        id: 'event-1',
        title: 'Physics lab',
        startsAt: '2026-05-12T17:00:00.000Z',
        createdAt: '2026-05-11T00:00:00.000Z',
        updatedAt: '2026-05-11T00:00:00.000Z',
      },
    ]);

    const { GET } = await import('@/app/api/scheduled-classes/route');
    const response = await GET(new NextRequest('http://localhost/api/scheduled-classes'));
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(listScheduledClassesForAccessMock).toHaveBeenCalledWith(scope);
    expect(json.events).toHaveLength(1);
  });

  it('creates a scheduled class linked to an accessible classroom', async () => {
    createScheduledClassForAccessMock.mockResolvedValue({
      id: 'event-1',
      title: 'Physics lab',
      startsAt: '2026-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });

    const { POST } = await import('@/app/api/scheduled-classes/route');
    const response = await POST(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Physics lab',
          startsAt: '2026-05-12T17:00:00.000Z',
          durationMinutes: 45,
          classroomId: 'room-1',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createScheduledClassForAccessMock).toHaveBeenCalledWith(
      scope,
      {
        title: 'Physics lab',
        startsAt: '2026-05-12T17:00:00.000Z',
        durationMinutes: 45,
        classroomId: 'room-1',
        multiplayerGame: undefined,
      },
      expect.objectContaining({ multiplayerInviteBaseUrl: 'http://localhost' }),
    );
    expect(json.event.id).toBe('event-1');
  });

  it('creates multiplayer scheduled classes for game-mode classrooms', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-1',
      ownerUserId: 'teacher-1',
      organizationId: 'org-1',
      stage: {
        id: 'room-1',
        name: 'Physics',
        sourceContext: { creationMode: 'game-arcade' },
      },
      scenes: [],
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });
    createScheduledClassForAccessMock.mockResolvedValue({
      id: 'event-1',
      title: 'Physics game',
      startsAt: '2026-05-12T17:00:00.000Z',
      classroomId: 'room-1',
      multiplayerGame: {
        enabled: true,
        mode: 'both',
        linkPolicy: 'always_open',
        inviteUrl: 'http://localhost/join/code',
      },
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });

    const { POST } = await import('@/app/api/scheduled-classes/route');
    const response = await POST(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Physics game',
          startsAt: '2026-05-12T17:00:00.000Z',
          classroomId: 'room-1',
          multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(201);
    expect(createScheduledClassForAccessMock).toHaveBeenCalledWith(
      scope,
      expect.objectContaining({
        classroomId: 'room-1',
        multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
      }),
      expect.objectContaining({ multiplayerInviteBaseUrl: 'http://localhost' }),
    );
    expect(json.event.multiplayerGame.inviteUrl).toBe('http://localhost/join/code');
  });

  it('rejects inaccessible classroom links before persistence', async () => {
    readClassroomMock.mockResolvedValue({
      id: 'room-2',
      ownerUserId: 'other-teacher',
      organizationId: 'org-1',
      stage: { id: 'room-2', name: 'Other' },
      scenes: [],
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T00:00:00.000Z',
    });

    const { POST } = await import('@/app/api/scheduled-classes/route');
    const response = await POST(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'POST',
        body: JSON.stringify({
          title: 'Physics lab',
          startsAt: '2026-05-12T17:00:00.000Z',
          classroomId: 'room-2',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Choose an accessible classroom for this scheduled class.');
    expect(createScheduledClassForAccessMock).not.toHaveBeenCalled();
  });

  it('updates and deletes scheduled classes by id', async () => {
    updateScheduledClassForAccessMock.mockResolvedValue({
      id: 'event-1',
      title: 'Updated lab',
      startsAt: '2026-05-12T18:00:00.000Z',
      createdAt: '2026-05-11T00:00:00.000Z',
      updatedAt: '2026-05-11T01:00:00.000Z',
    });
    deleteScheduledClassForAccessMock.mockResolvedValue(true);

    const { PATCH, DELETE } = await import('@/app/api/scheduled-classes/route');
    const patchResponse = await PATCH(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'PATCH',
        body: JSON.stringify({
          id: 'event-1',
          title: 'Updated lab',
          startsAt: '2026-05-12T18:00:00.000Z',
        }),
      }),
    );
    const deleteResponse = await DELETE(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'DELETE',
        body: JSON.stringify({ id: 'event-1' }),
      }),
    );

    expect(patchResponse.status).toBe(200);
    expect(updateScheduledClassForAccessMock).toHaveBeenCalledWith(
      scope,
      'event-1',
      {
        title: 'Updated lab',
        startsAt: '2026-05-12T18:00:00.000Z',
        durationMinutes: undefined,
        classroomId: undefined,
        multiplayerGame: undefined,
      },
      expect.objectContaining({ multiplayerInviteBaseUrl: 'http://localhost' }),
    );
    expect(deleteResponse.status).toBe(200);
    expect(deleteScheduledClassForAccessMock).toHaveBeenCalledWith(scope, 'event-1');
  });

  it('rejects scheduled class updates without an id', async () => {
    const { PATCH } = await import('@/app/api/scheduled-classes/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'PATCH',
        body: JSON.stringify({
          title: 'Updated lab',
          startsAt: '2026-05-12T18:00:00.000Z',
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'MISSING_REQUIRED_FIELD',
      error: 'Missing required field: id',
    });
    expect(updateScheduledClassForAccessMock).not.toHaveBeenCalled();
  });

  it('surfaces scheduled class update validation errors as recoverable requests', async () => {
    updateScheduledClassForAccessMock.mockRejectedValue(
      new Error('Duration must be between 1 minute and 24 hours.'),
    );

    const { PATCH } = await import('@/app/api/scheduled-classes/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'PATCH',
        body: JSON.stringify({
          id: 'event-1',
          title: 'Updated lab',
          startsAt: '2026-05-12T18:00:00.000Z',
          durationMinutes: 'abc',
        }),
      }),
    );
    const json = await response.json();
    const [, , input] = updateScheduledClassForAccessMock.mock.calls[0];

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'Duration must be between 1 minute and 24 hours.',
    });
    expect(Number.isNaN(input.durationMinutes)).toBe(true);
  });

  it('rejects multiplayer updates for non-game classrooms before persistence', async () => {
    const { PATCH } = await import('@/app/api/scheduled-classes/route');
    const response = await PATCH(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'PATCH',
        body: JSON.stringify({
          id: 'event-1',
          title: 'Physics game',
          startsAt: '2026-05-12T18:00:00.000Z',
          classroomId: 'room-1',
          multiplayerGame: { enabled: true, mode: 'both', linkPolicy: 'always_open' },
        }),
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'INVALID_REQUEST',
      error: 'Multiplayer scheduling is available for game-mode classrooms only.',
    });
    expect(updateScheduledClassForAccessMock).not.toHaveBeenCalled();
  });

  it('deletes scheduled classes from the query id fallback', async () => {
    deleteScheduledClassForAccessMock.mockResolvedValue(true);

    const { DELETE } = await import('@/app/api/scheduled-classes/route');
    const response = await DELETE(
      new NextRequest('http://localhost/api/scheduled-classes?id=event-1', {
        method: 'DELETE',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ success: true, event: null });
    expect(deleteScheduledClassForAccessMock).toHaveBeenCalledWith(scope, 'event-1');
  });

  it('rejects scheduled class deletes without an id', async () => {
    const { DELETE } = await import('@/app/api/scheduled-classes/route');
    const response = await DELETE(
      new NextRequest('http://localhost/api/scheduled-classes', {
        method: 'DELETE',
      }),
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json).toMatchObject({
      success: false,
      errorCode: 'MISSING_REQUIRED_FIELD',
      error: 'Missing required field: id',
    });
    expect(deleteScheduledClassForAccessMock).not.toHaveBeenCalled();
  });

  it('requires teacher access', async () => {
    requireRequestRoleMock.mockResolvedValue(
      NextResponse.json(
        {
          success: false,
          errorCode: 'UNAUTHORIZED',
          error: 'Authentication required',
        },
        { status: 401 },
      ),
    );

    const { GET } = await import('@/app/api/scheduled-classes/route');
    const response = await GET(new NextRequest('http://localhost/api/scheduled-classes'));

    expect(response.status).toBe(401);
    expect(listScheduledClassesForAccessMock).not.toHaveBeenCalled();
  });
});
