import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const requireClassroomAccessMock = vi.fn();
const getClassroomCollaborationSnapshotMock = vi.fn();
const buildClassroomCollaborationStatePayloadMock = vi.fn();
const getClassroomCollaborationFingerprintMock = vi.fn();
const listClassroomRoomEventsSinceMock = vi.fn();
const subscribeToClassroomRoomEventsMock = vi.fn();

vi.mock('@/lib/auth/classroom-access', () => ({
  requireClassroomAccess: requireClassroomAccessMock,
}));

vi.mock('@/lib/server/classroom-collaboration', () => ({
  getClassroomCollaborationSnapshot: getClassroomCollaborationSnapshotMock,
  buildClassroomCollaborationStatePayload: buildClassroomCollaborationStatePayloadMock,
  getClassroomCollaborationFingerprint: getClassroomCollaborationFingerprintMock,
}));

vi.mock('@/lib/server/classroom-room-events', () => ({
  listClassroomRoomEventsSince: listClassroomRoomEventsSinceMock,
  subscribeToClassroomRoomEvents: subscribeToClassroomRoomEventsMock,
}));

describe('GET /api/classroom/[id]/collaboration-events', () => {
  beforeEach(() => {
    vi.resetModules();
    requireClassroomAccessMock.mockReset();
    getClassroomCollaborationSnapshotMock.mockReset();
    buildClassroomCollaborationStatePayloadMock.mockReset();
    getClassroomCollaborationFingerprintMock.mockReset();
    listClassroomRoomEventsSinceMock.mockReset();
    subscribeToClassroomRoomEventsMock.mockReset();
    listClassroomRoomEventsSinceMock.mockResolvedValue([]);
    subscribeToClassroomRoomEventsMock.mockReturnValue(() => undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('streams the initial collaboration snapshot for authorized viewers', async () => {
    const abortController = new AbortController();
    const payload = {
      collaborationMode: 'multi-user',
      collaborationState: 'live',
      allowStudentInteraction: true,
      spotlightSessionId: null,
      participantCount: 3,
      participants: [],
      mirofishSessionId: 'miro-session-1',
      lastCollaborationSyncAt: '2026-04-11T00:00:00.000Z',
      viewerSessionId: 'teacher-session',
      viewerRole: 'teacher',
      viewerKind: 'web',
      viewerCanModerateCollaboration: true,
      viewerCanInteract: true,
      viewerIsRemoved: false,
      viewerInteractionReason: null,
      multiUserEnabled: true,
    };

    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomCollaborationSnapshotMock.mockResolvedValue({ id: 'snapshot-1' });
    buildClassroomCollaborationStatePayloadMock.mockReturnValue(payload);
    getClassroomCollaborationFingerprintMock.mockReturnValue('fp-1');

    const { GET } = await import('@/app/api/classroom/[id]/collaboration-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration-events', {
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);

    expect(text).toContain('event: collaboration-state');
    expect(text).toContain(`data: ${JSON.stringify(payload)}`);

    abortController.abort();
    await reader!.cancel();
  });

  it('returns 404 when the collaboration snapshot is missing', async () => {
    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomCollaborationSnapshotMock.mockResolvedValue(null);

    const { GET } = await import('@/app/api/classroom/[id]/collaboration-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration-events'),
      {
        params: Promise.resolve({ id: 'room-1' }),
      },
    );
    const json = await response.json();

    expect(response.status).toBe(404);
    expect(json.error).toBe('Classroom not found');
  });

  it('replays the latest relevant room event id on the initial SSE payload', async () => {
    const abortController = new AbortController();
    const payload = {
      collaborationMode: 'multi-user',
      collaborationState: 'live',
      allowStudentInteraction: true,
      spotlightSessionId: null,
      participantCount: 3,
      participants: [],
      mirofishSessionId: 'miro-session-1',
      lastCollaborationSyncAt: '2026-04-11T00:00:00.000Z',
      viewerSessionId: 'teacher-session',
      viewerRole: 'teacher',
      viewerKind: 'web',
      viewerCanModerateCollaboration: true,
      viewerCanInteract: true,
      viewerIsRemoved: false,
      viewerInteractionReason: null,
      multiUserEnabled: true,
    };

    requireClassroomAccessMock.mockResolvedValue({
      auth: {
        session: { id: 'teacher-session', kind: 'web', role: 'teacher' },
        user: { id: 'teacher-1' },
      },
      source: 'web',
    });
    getClassroomCollaborationSnapshotMock.mockResolvedValue({ id: 'snapshot-1' });
    buildClassroomCollaborationStatePayloadMock.mockReturnValue(payload);
    getClassroomCollaborationFingerprintMock.mockReturnValue('fp-1');
    listClassroomRoomEventsSinceMock.mockResolvedValue([
      {
        eventId: 'evt-1',
        kind: 'control.updated',
      },
      {
        eventId: 'evt-3',
        kind: 'collaboration.updated',
      },
    ]);

    const { GET } = await import('@/app/api/classroom/[id]/collaboration-events/route');
    const response = await GET(
      new NextRequest('http://localhost/api/classroom/room-1/collaboration-events', {
        headers: {
          'Last-Event-ID': 'evt-0',
        },
        signal: abortController.signal,
      }),
      { params: Promise.resolve({ id: 'room-1' }) },
    );

    const reader = response.body?.getReader();
    expect(reader).toBeTruthy();
    const firstChunk = await reader!.read();
    const text = new TextDecoder().decode(firstChunk.value);

    expect(listClassroomRoomEventsSinceMock).toHaveBeenCalledWith('room-1', 'evt-0');
    expect(text).toContain('id: evt-3');
    expect(text).toContain('event: collaboration-state');

    abortController.abort();
    await reader!.cancel();
  });
});
