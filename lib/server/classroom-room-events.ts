import 'server-only';

import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { getDataPath } from '@/lib/server/data-root';
import type {
  ClassroomRoomEvent,
  ClassroomRoomEventActor,
  ClassroomRoomEventKind,
} from '@/lib/types/live-classroom';

const CLASSROOM_ROOM_EVENTS_DIR = getDataPath('classroom-room-events');
const roomEventSubscribers = new Map<string, Set<(event: ClassroomRoomEvent) => void>>();

async function ensureRoomEventsDir() {
  await fs.mkdir(CLASSROOM_ROOM_EVENTS_DIR, { recursive: true });
}

function resolveRoomEventLogPath(classroomId: string) {
  return `${CLASSROOM_ROOM_EVENTS_DIR}/${classroomId}.jsonl`;
}

export function subscribeToClassroomRoomEvents(
  classroomId: string,
  listener: (event: ClassroomRoomEvent) => void,
) {
  const subscribers = roomEventSubscribers.get(classroomId) ?? new Set();
  subscribers.add(listener);
  roomEventSubscribers.set(classroomId, subscribers);

  return () => {
    const activeSubscribers = roomEventSubscribers.get(classroomId);
    if (!activeSubscribers) {
      return;
    }

    activeSubscribers.delete(listener);
    if (activeSubscribers.size === 0) {
      roomEventSubscribers.delete(classroomId);
    }
  };
}

function publishClassroomRoomEvent(event: ClassroomRoomEvent) {
  const subscribers = roomEventSubscribers.get(event.classroomId);
  if (!subscribers) {
    return;
  }

  for (const subscriber of subscribers) {
    try {
      subscriber(event);
    } catch {
      // Best-effort bus; per-subscriber failures should not affect persistence.
    }
  }
}

export function buildClassroomRoomEventActor(input: {
  sessionId?: string | null;
  userId?: string | null;
  role?: string | null;
  kind: ClassroomRoomEventActor['kind'];
}): ClassroomRoomEventActor {
  return {
    sessionId: input.sessionId ?? null,
    userId: input.userId ?? null,
    role: input.role ?? null,
    kind: input.kind,
  };
}

export async function recordClassroomRoomEvent(input: {
  classroomId: string;
  roomVersion: number;
  kind: ClassroomRoomEventKind;
  actor: ClassroomRoomEventActor;
  metadata?: Record<string, unknown>;
}) {
  const event: ClassroomRoomEvent = {
    classroomId: input.classroomId,
    roomVersion: input.roomVersion,
    eventId: randomUUID(),
    kind: input.kind,
    occurredAt: new Date().toISOString(),
    actor: input.actor,
    metadata: input.metadata,
  };

  await ensureRoomEventsDir();
  await fs.appendFile(
    resolveRoomEventLogPath(input.classroomId),
    `${JSON.stringify(event)}\n`,
    'utf-8',
  );
  publishClassroomRoomEvent(event);
  return event;
}

export async function listClassroomRoomEventsSince(
  classroomId: string,
  lastEventId?: string | null,
) {
  if (!lastEventId) {
    return [] as ClassroomRoomEvent[];
  }

  await ensureRoomEventsDir();

  try {
    const logContent = await fs.readFile(resolveRoomEventLogPath(classroomId), 'utf-8');
    const events = logContent
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line) as ClassroomRoomEvent);
    const eventIndex = events.findIndex((event) => event.eventId === lastEventId);
    return eventIndex >= 0 ? events.slice(eventIndex + 1) : events;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return [] as ClassroomRoomEvent[];
    }

    throw error;
  }
}
