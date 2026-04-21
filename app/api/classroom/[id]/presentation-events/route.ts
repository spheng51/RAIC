import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  buildClassroomPresentationStatePayload,
  getClassroomPresentationFingerprint,
  getClassroomPresentationSnapshot,
} from '@/lib/server/classroom-presentation';
import {
  listClassroomRoomEventsSince,
  subscribeToClassroomRoomEvents,
} from '@/lib/server/classroom-room-events';
import {
  apiErrorWithRequestSession,
  API_ERROR_CODES,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { isValidClassroomId } from '@/lib/server/classroom-storage';
import type { ClassroomRoomEventKind } from '@/lib/types/live-classroom';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();
const FALLBACK_POLL_INTERVAL_MS = 5_000;
const PRESENTATION_EVENT_KINDS = new Set<ClassroomRoomEventKind>([
  'presentation.updated',
  'collaboration.updated',
  'control.updated',
  'mirofish.attached',
  'mirofish.session.updated',
]);

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

  const initialSnapshot = await getClassroomPresentationSnapshot(id);
  if (!initialSnapshot) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  const initialPayload = buildClassroomPresentationStatePayload(
    initialSnapshot,
    access.auth.session,
  );
  const initialFingerprint = getClassroomPresentationFingerprint(initialPayload);
  const lastEventId = request.headers.get('last-event-id') ?? request.headers.get('Last-Event-ID');
  const pendingRoomEvents = await listClassroomRoomEventsSince(id, lastEventId);
  const latestRelevantRoomEventId =
    pendingRoomEvents
      .filter((event) => PRESENTATION_EVENT_KINDS.has(event.kind))
      .at(-1)?.eventId ?? undefined;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let fingerprint = initialFingerprint;
      let snapshotPollInFlight = false;
      let unsubscribeFromRoomEvents: (() => void) | null = null;
      let snapshotInterval: ReturnType<typeof setInterval> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
        if (unsubscribeFromRoomEvents) {
          unsubscribeFromRoomEvents();
          unsubscribeFromRoomEvents = null;
        }
        if (snapshotInterval) {
          clearInterval(snapshotInterval);
          snapshotInterval = null;
        }
        if (heartbeatInterval) {
          clearInterval(heartbeatInterval);
          heartbeatInterval = null;
        }
      };

      const closeStream = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();
        try {
          controller.close();
        } catch {
          // Ignore close errors after consumer disconnects.
        }
      };

      const emitPresentationState = async (eventId?: string) => {
        if (closed || snapshotPollInFlight) {
          return;
        }

        snapshotPollInFlight = true;
        try {
          const nextSnapshot = await getClassroomPresentationSnapshot(id);
          if (!nextSnapshot) {
            closeStream();
            return;
          }

          const nextPayload = buildClassroomPresentationStatePayload(
            nextSnapshot,
            access.auth.session,
          );
          const nextFingerprint = getClassroomPresentationFingerprint(nextPayload);
          if (nextFingerprint === fingerprint) {
            return;
          }

          fingerprint = nextFingerprint;
          controller.enqueue(encodeEvent('presentation-state', nextPayload, eventId));
        } catch {
          closeStream();
        } finally {
          snapshotPollInFlight = false;
        }
      };

      controller.enqueue(
        encodeEvent('presentation-state', initialPayload, latestRelevantRoomEventId),
      );
      heartbeatInterval = setInterval(() => {
        if (closed) {
          return;
        }

        controller.enqueue(
          encodeEvent('heartbeat', {
            ts: new Date().toISOString(),
          }),
        );
      }, 20_000);
      unsubscribeFromRoomEvents = subscribeToClassroomRoomEvents(id, (event) => {
        if (!PRESENTATION_EVENT_KINDS.has(event.kind)) {
          return;
        }

        void emitPresentationState(event.eventId);
      });
      snapshotInterval = setInterval(() => {
        void emitPresentationState();
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
