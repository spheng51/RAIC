import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  buildClassroomCollaborationStatePayload,
  getClassroomCollaborationFingerprint,
  getClassroomCollaborationSnapshot,
} from '@/lib/server/classroom-collaboration';
import {
  apiErrorWithRequestSession,
  API_ERROR_CODES,
  withRequestWebSession,
} from '@/lib/server/api-response';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

export const dynamic = 'force-dynamic';

const encoder = new TextEncoder();

function encodeEvent(name: string, payload: unknown) {
  return encoder.encode(`event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
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

  const initialSnapshot = await getClassroomCollaborationSnapshot(id);
  if (!initialSnapshot) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  const initialPayload = buildClassroomCollaborationStatePayload(
    initialSnapshot,
    access.auth.session,
  );
  const initialFingerprint = getClassroomCollaborationFingerprint(initialPayload);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      let fingerprint = initialFingerprint;
      let snapshotPollInFlight = false;
      let snapshotInterval: ReturnType<typeof setInterval> | null = null;
      let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

      const cleanup = () => {
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

      const emitCollaborationState = async () => {
        if (closed || snapshotPollInFlight) {
          return;
        }

        snapshotPollInFlight = true;
        try {
          const nextSnapshot = await getClassroomCollaborationSnapshot(id);
          if (!nextSnapshot) {
            closeStream();
            return;
          }

          const nextPayload = buildClassroomCollaborationStatePayload(
            nextSnapshot,
            access.auth.session,
          );
          const nextFingerprint = getClassroomCollaborationFingerprint(nextPayload);
          if (nextFingerprint === fingerprint) {
            return;
          }

          fingerprint = nextFingerprint;
          controller.enqueue(encodeEvent('collaboration-state', nextPayload));
        } catch {
          closeStream();
        } finally {
          snapshotPollInFlight = false;
        }
      };

      controller.enqueue(encodeEvent('collaboration-state', initialPayload));
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
      snapshotInterval = setInterval(() => {
        void emitCollaborationState();
      }, 1_000);

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
