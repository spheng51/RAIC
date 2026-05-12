import { nanoid } from 'nanoid';
import { db } from '@/lib/utils/database';
import type { ScheduledClassEvent, ScheduledClassEventInput } from '@/lib/types/scheduled-classes';
import {
  normalizeScheduledClassInput,
  sortScheduledClassEvents,
} from '@/lib/utils/scheduled-classes';

function nowIso() {
  return new Date().toISOString();
}

export async function listLocalScheduledClassEvents(): Promise<ScheduledClassEvent[]> {
  const events = await db.scheduledClassEvents.toArray();
  return sortScheduledClassEvents(events);
}

export async function createLocalScheduledClassEvent(
  input: ScheduledClassEventInput,
): Promise<ScheduledClassEvent> {
  const normalized = normalizeScheduledClassInput(input, { requireFutureStart: true });
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const timestamp = nowIso();
  const event: ScheduledClassEvent = {
    id: nanoid(),
    ...normalized.value,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.scheduledClassEvents.put(event);
  return event;
}

export async function updateLocalScheduledClassEvent(
  id: string,
  input: ScheduledClassEventInput,
): Promise<ScheduledClassEvent> {
  const existing = await db.scheduledClassEvents.get(id);
  if (!existing) {
    throw new Error('Scheduled class not found.');
  }

  const normalized = normalizeScheduledClassInput(input, { requireFutureStart: true });
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const event: ScheduledClassEvent = {
    ...existing,
    title: normalized.value.title,
    startsAt: normalized.value.startsAt,
    durationMinutes: normalized.value.durationMinutes,
    classroomId: normalized.value.classroomId,
    updatedAt: nowIso(),
  };
  await db.scheduledClassEvents.put(event);
  return event;
}

export async function deleteLocalScheduledClassEvent(id: string): Promise<void> {
  await db.scheduledClassEvents.delete(id);
}
