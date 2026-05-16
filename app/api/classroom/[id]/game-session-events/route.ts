import { type NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  API_ERROR_CODES,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { touchSession } from '@/lib/db/repositories/sessions';
import {
  getClassroomGameSessionFingerprint,
  getClassroomGameSessionPayload,
} from '@/lib/server/classroom-game-session';
import {
  listClassroomRoomEventsSince,
  subscribeToClassroomRoomEvents,
} from '@/lib/server/classroom-room-events';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const FALLBACK_POLL_INTERVAL_MS = 5_000;
const HEARTBEAT_INTERVAL_MS = 20_000;

function encodeEvent(name: string, payload: unknown, id?: string) {
  const lines = id
    ? [`id: ${id}`, `event: ${name}`, `data: ${JSON.stringify(payload)}`]
    : [`event: ${name}`, `data: ${JSON.stringify(payload)}`];
  return encoder.encode(`${lines.join('\n')}\n\n`);
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid classroom id',
    );
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  const initialPayload = await getClassroomGameSessionPayload(id, access.auth.session);
  if (!initialPayload) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  const initialFingerprint = getClassroomGameSessionFingerprint(initialPayload);
  const lastEventId = request.headers.get('last-event-id') ?? request.headers.get('Last-Event-ID');
  const pendingRoomEvents = await listClassroomRoomEventsSince(id, lastEventId);
  const latestRelevantRoomEventId =
    pendingRoomEvents.filter((event) => event.kind === 'game_session.updated').at(-1)?.eventId ??
    undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let fingerprint = initialFingerprint;
      let snapshotPollInFlight = false;
      let unsubscribeFromRoomEvents: (() => void) | null = null;
      let snapshotInterval: ReturnType<typeof setInterval> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        unsubscribeFromRoomEvents?.();
        unsubscribeFromRoomEvents = null;
        if (snapshotInterval) clearInterval(snapshotInterval);
        if (heartbeatInterval) clearInterval(heartbeatInterval);
      };

      const closeStream = () => {
        if (closed) return;
        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Ignore close after consumer disconnects.
        }
      };

      const emitGameSessionState = async (eventId?: string) => {
        if (closed || snapshotPollInFlight) return;
        snapshotPollInFlight = true;
        try {
          const nextPayload = await getClassroomGameSessionPayload(id, access.auth.session);
          if (!nextPayload) {
            closeStream();
            return;
          }

          const nextFingerprint = getClassroomGameSessionFingerprint(nextPayload);
          if (nextFingerprint !== fingerprint) {
            fingerprint = nextFingerprint;
            controller.enqueue(encodeEvent('game-session-state', nextPayload, eventId));
          }
        } catch {
          closeStream();
        } finally {
          snapshotPollInFlight = false;
        }
      };

      const touchPresence = () => {
        void touchSession(access.auth.session.id, {
          lastSeenAt: new Date().toISOString(),
          expiresAt: access.auth.session.expiresAt,
        }).catch(() => undefined);
      };

      controller.enqueue(
        encodeEvent('game-session-state', initialPayload, latestRelevantRoomEventId),
      );
      touchPresence();
      heartbeatInterval = setInterval(() => {
        if (!closed) {
          touchPresence();
          controller.enqueue(encodeEvent('heartbeat', { ts: new Date().toISOString() }));
        }
      }, HEARTBEAT_INTERVAL_MS);
      unsubscribeFromRoomEvents = subscribeToClassroomRoomEvents(id, (event) => {
        if (event.kind === 'game_session.updated') {
          void emitGameSessionState(event.eventId);
        }
      });
      snapshotInterval = setInterval(() => {
        void emitGameSessionState();
      }, FALLBACK_POLL_INTERVAL_MS);

      request.signal.addEventListener('abort', closeStream, { once: true });
    },
  });

  return withRequestWebSession(
    request,
    new NextResponse(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    }),
  );
}
