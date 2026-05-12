import 'server-only';

import { randomUUID } from 'crypto';
import { isPostgresConfigured, readPlatformStore, updatePlatformStore } from '@/lib/db/client';
import {
  deleteScheduledClassEventRecord,
  listScheduledClassEventRecordsForAccess,
  readScheduledClassEventRecord,
  upsertScheduledClassEventRecord,
} from '@/lib/db/repositories/scheduled-classes';
import type { PlatformRole, ScheduledClassEventRecord } from '@/lib/db/schema';
import type { ScheduledClassEvent, ScheduledClassEventInput } from '@/lib/types/scheduled-classes';
import {
  normalizeScheduledClassInput,
  sortScheduledClassEvents,
} from '@/lib/utils/scheduled-classes';

export interface ScheduledClassAccessScope {
  role: PlatformRole;
  userId: string;
  organizationId?: string | null;
}

function canAccessEvent(event: ScheduledClassEventRecord, scope: ScheduledClassAccessScope) {
  if (scope.role === 'system_admin') return true;
  if (scope.role === 'org_admin') {
    return !!scope.organizationId && event.organizationId === scope.organizationId;
  }
  if (scope.role === 'teacher') {
    return event.ownerUserId === scope.userId;
  }
  return false;
}

function toClientEvent(event: ScheduledClassEventRecord): ScheduledClassEvent {
  const { ownerUserId: _ownerUserId, organizationId: _organizationId, ...clientEvent } = event;
  return clientEvent;
}

export async function listScheduledClassesForAccess(
  scope: ScheduledClassAccessScope,
): Promise<ScheduledClassEvent[]> {
  if (isPostgresConfigured()) {
    const records = await listScheduledClassEventRecordsForAccess(scope);
    return sortScheduledClassEvents(records.map(toClientEvent));
  }

  const store = await readPlatformStore();
  return sortScheduledClassEvents(
    store.scheduledClassEvents.filter((event) => canAccessEvent(event, scope)).map(toClientEvent),
  );
}

export async function createScheduledClassForAccess(
  scope: ScheduledClassAccessScope,
  input: ScheduledClassEventInput,
  options: { requireFutureStart?: boolean } = {},
): Promise<ScheduledClassEvent> {
  const normalized = normalizeScheduledClassInput(input, {
    requireFutureStart: options.requireFutureStart ?? true,
  });
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  const timestamp = new Date().toISOString();
  const record: ScheduledClassEventRecord = {
    id: randomUUID(),
    ownerUserId: scope.userId,
    organizationId: scope.organizationId ?? null,
    ...normalized.value,
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  if (isPostgresConfigured()) {
    const saved = await upsertScheduledClassEventRecord(record);
    if (!saved) {
      throw new Error('Failed to save scheduled class.');
    }
    return toClientEvent(saved);
  }

  await updatePlatformStore((store) => {
    store.scheduledClassEvents.push(record);
  });
  return toClientEvent(record);
}

export async function updateScheduledClassForAccess(
  scope: ScheduledClassAccessScope,
  id: string,
  input: ScheduledClassEventInput,
): Promise<ScheduledClassEvent | null> {
  const normalized = normalizeScheduledClassInput(input, { requireFutureStart: true });
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }

  if (isPostgresConfigured()) {
    const existing = await readScheduledClassEventRecord(id);
    if (!existing || !canAccessEvent(existing, scope)) {
      return null;
    }

    const updated = await upsertScheduledClassEventRecord({
      ...existing,
      title: normalized.value.title,
      startsAt: normalized.value.startsAt,
      durationMinutes: normalized.value.durationMinutes,
      classroomId: normalized.value.classroomId,
      updatedAt: new Date().toISOString(),
    });
    return updated ? toClientEvent(updated) : null;
  }

  return updatePlatformStore((store) => {
    const index = store.scheduledClassEvents.findIndex((event) => event.id === id);
    const existing = index >= 0 ? store.scheduledClassEvents[index] : null;
    if (!existing || !canAccessEvent(existing, scope)) {
      return null;
    }

    const updated: ScheduledClassEventRecord = {
      ...existing,
      title: normalized.value.title,
      startsAt: normalized.value.startsAt,
      durationMinutes: normalized.value.durationMinutes,
      classroomId: normalized.value.classroomId,
      updatedAt: new Date().toISOString(),
    };
    store.scheduledClassEvents[index] = updated;
    return toClientEvent(updated);
  });
}

export async function deleteScheduledClassForAccess(
  scope: ScheduledClassAccessScope,
  id: string,
): Promise<boolean> {
  if (isPostgresConfigured()) {
    const existing = await readScheduledClassEventRecord(id);
    if (!existing || !canAccessEvent(existing, scope)) {
      return false;
    }
    return deleteScheduledClassEventRecord(id);
  }

  return updatePlatformStore((store) => {
    const index = store.scheduledClassEvents.findIndex((event) => event.id === id);
    const existing = index >= 0 ? store.scheduledClassEvents[index] : null;
    if (!existing || !canAccessEvent(existing, scope)) {
      return false;
    }
    store.scheduledClassEvents.splice(index, 1);
    return true;
  });
}
