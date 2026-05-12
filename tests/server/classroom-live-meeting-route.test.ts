import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const requireRequestRoleMock = vi.fn();
const requireClassroomAccessMock = vi.fn();
const updateClassroomMock = vi.fn();
const recordAuditEventMock = vi.fn();
const recordClassroomRoomEventMock = vi.fn();
const buildClassroomRoomEventActorMock = vi.fn((actor) => actor);

vi.mock('@/lib/auth/authorize', () => ({
  requireRequestRole: requireRequestRoleMock,
}));

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-storage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/server/classroom-storage')>();
  return {
    ...actual,
    updateClassroom: updateClassroomMock,
  };
});

vi.mock('@/lib/server/audit-log', () => ({
  recordAuditEvent: recordAuditEventMock,
}));

vi.mock('@/lib/server/classroom-room-events', () => ({
  buildClassroomRoomEventActor: buildClassroomRoomEventActorMock,
  recordClassroomRoomEvent: recordClassroomRoomEventMock,
}));

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

function buildClassroom(overrides: Record<string, unknown> = {}) {
  return {
    id: 'room-1',
    ownerUserId: 'teacher-1',
    organizationId: 'org-1',
    roomVersion: 1,
    stage: { id: 'room-1', name: 'Physics' },
    scenes: [],
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z',
    ...overrides,
  };
}

describe('/api/classroom/[id]/live-meeting', () => {
  beforeEach(() => {
    vi.resetModules();
    requireRequestRoleMock.mockReset();
    requireClassroomAccessMock.mockReset();
    updateClassroomMock.mockReset();
    recordAuditEventMock.mockReset();
    recordClassroomRoomEventMock.mockReset();
    buildClassroomRoomEventActorMock.mockClear();

    requireRequestRoleMock.mockResolvedValue(authContext);
    requireClassroomAccessMock.mockResolvedValue({
      auth: authContext,
      source: 'web',
      classroom: buildClassroom(),
    });
    updateClassroomMock.mockImplementation(async (_id, updater) => {
      const next = updater(buildClassroom());
      return {
        ...next,
        roomVersion: 2,
        updatedAt: '2026-04-13T00:01:00.000Z',
      };
    });
  });

  it('returns the attached live meeting for authorized classroom participants', async () => {
    const liveMeeting = {
      provider: 'zoom',
      source: 'manual-link',
      joinUrl: 'https://zoom.us/j/123456789',
      attachedAt: '2026-04-13T00:00:00.000Z',
      attachedByUserId: 'teacher-1',
    };
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'student-session', kind: 'classroom', role: 'student' },
        user: { id: 'student-1' },
      },
      source: 'classroom',
      classroom: buildClassroom({ stage: { id: 'room-1', liveMeeting } }),
    });

    const { GET } = await import('@/app/api/classroom/[id]/live-meeting/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/live-meeting'),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.liveMeeting).toEqual(liveMeeting);
  });

  it('attaches a validated Zoom link and emits a room event', async () => {
    const { PUT } = await import('@/app/api/classroom/[id]/live-meeting/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/classroom/room-1/live-meeting', {
        method: 'PUT',
        body: JSON.stringify({
          joinUrl: 'https://us02web.zoom.us/j/123456789?pwd=abc',
          label: 'Office hours',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.liveMeeting).toEqual(
      expect.objectContaining({
        provider: 'zoom',
        source: 'manual-link',
        joinUrl: 'https://us02web.zoom.us/j/123456789?pwd=abc',
        label: 'Office hours',
        attachedByUserId: 'teacher-1',
      }),
    );
    expect(updateClassroomMock).toHaveBeenCalledWith('room-1', expect.any(Function));
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.live_meeting.attached',
        resourceId: 'room-1',
        metadata: expect.objectContaining({
          host: 'us02web.zoom.us',
          provider: 'zoom',
          source: 'manual-link',
        }),
      }),
    );
    const auditMetadata = recordAuditEventMock.mock.calls[0]?.[0]?.metadata;
    expect(auditMetadata).not.toHaveProperty('joinUrl');
    expect(JSON.stringify(auditMetadata)).not.toContain('pwd=abc');
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        classroomId: 'room-1',
        roomVersion: 2,
        kind: 'live_meeting.updated',
      }),
    );
  });

  it('rejects invalid Zoom links before persistence', async () => {
    const { PUT } = await import('@/app/api/classroom/[id]/live-meeting/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/classroom/room-1/live-meeting', {
        method: 'PUT',
        body: JSON.stringify({
          joinUrl: 'https://meet.example.com/j/123',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe('Only approved Zoom meeting links can be attached.');
    expect(updateClassroomMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('rejects generic Zoom pages before persistence', async () => {
    const { PUT } = await import('@/app/api/classroom/[id]/live-meeting/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/classroom/room-1/live-meeting', {
        method: 'PUT',
        body: JSON.stringify({
          joinUrl: 'https://zoom.us/profile',
        }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.error).toBe(
      'Use an attendee Zoom invite link in the format https://zoom.us/j/{meetingId}.',
    );
    expect(updateClassroomMock).not.toHaveBeenCalled();
    expect(recordAuditEventMock).not.toHaveBeenCalled();
  });

  it('removes an attached live meeting and emits a room event', async () => {
    const liveMeeting = {
      provider: 'zoom',
      source: 'manual-link',
      joinUrl: 'https://zoom.us/j/123456789',
      attachedAt: '2026-04-13T00:00:00.000Z',
      attachedByUserId: 'teacher-1',
    };
    requireClassroomAccessMock.mockResolvedValue({
      auth: authContext,
      source: 'web',
      classroom: buildClassroom({ stage: { id: 'room-1', liveMeeting } }),
    });
    updateClassroomMock.mockImplementation(async (_id, updater) => {
      const next = updater(buildClassroom({ stage: { id: 'room-1', liveMeeting } }));
      return { ...next, roomVersion: 2 };
    });

    const { DELETE } = await import('@/app/api/classroom/[id]/live-meeting/route');
    const response = await DELETE(
      new NextRequest('http://localhost/api/classroom/room-1/live-meeting', {
        method: 'DELETE',
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(json.liveMeeting).toBeNull();
    expect(recordAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'classroom.live_meeting.removed',
        resourceId: 'room-1',
      }),
    );
    expect(recordClassroomRoomEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'live_meeting.updated',
      }),
    );
  });

  it('returns authorization failures without mutating the classroom', async () => {
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

    const { PUT } = await import('@/app/api/classroom/[id]/live-meeting/route');
    const response = await PUT(
      new NextRequest('http://localhost/api/classroom/room-1/live-meeting', {
        method: 'PUT',
        body: JSON.stringify({ joinUrl: 'https://zoom.us/j/123456789' }),
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(401);
    expect(requireClassroomAccessMock).not.toHaveBeenCalled();
    expect(updateClassroomMock).not.toHaveBeenCalled();
  });
});
