import 'server-only';

import { randomUUID } from 'crypto';
import { createOpaqueToken, hashToken } from '@/lib/auth/session';
import { isPostgresConfigured, readPlatformStore, updatePlatformStore } from '@/lib/db/client';
import {
  createJoinTokenRecord,
  updateJoinTokenExpiration,
} from '@/lib/db/repositories/join-tokens';
import {
  deleteScheduledClassEventRecord,
  listScheduledClassEventRecordsForAccess,
  readScheduledClassEventRecord,
  upsertScheduledClassEventRecord,
} from '@/lib/db/repositories/scheduled-classes';
import type { PlatformRole, ScheduledClassEventRecord } from '@/lib/db/schema';
import type { ScheduledClassEvent, ScheduledClassEventInput } from '@/lib/types/scheduled-classes';
import {
  getScheduledClassInviteExpiresAt,
  normalizeScheduledClassInput,
  sortScheduledClassEvents,
  type NormalizedScheduledClassEventInput,
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

function buildInviteUrl(baseUrl: string, rawToken: string) {
  return `${new URL(baseUrl).origin}/join/${rawToken}`;
}

async function ensureScheduledMultiplayerInvite(
  scope: ScheduledClassAccessScope,
  input: NormalizedScheduledClassEventInput,
  options: { multiplayerInviteBaseUrl?: string } = {},
): Promise<NormalizedScheduledClassEventInput> {
  if (!input.multiplayerGame?.enabled || !input.classroomId) {
    return input;
  }

  const inviteExpiresAt = getScheduledClassInviteExpiresAt({
    startsAt: input.startsAt,
    durationMinutes: input.durationMinutes,
  });

  if (input.multiplayerGame.joinTokenId && input.multiplayerGame.inviteUrl) {
    const refreshedToken = await updateJoinTokenExpiration(
      input.multiplayerGame.joinTokenId,
      inviteExpiresAt,
    );
    if (refreshedToken || !options.multiplayerInviteBaseUrl) {
      return {
        ...input,
        multiplayerGame: {
          ...input.multiplayerGame,
          inviteExpiresAt,
        },
      };
    }
  }

  if (!options.multiplayerInviteBaseUrl) {
    return {
      ...input,
      multiplayerGame: {
        ...input.multiplayerGame,
        inviteExpiresAt,
      },
    };
  }
  const rawToken = createOpaqueToken();
  const joinToken = await createJoinTokenRecord({
    classroomId: input.classroomId,
    createdByUserId: scope.userId,
    organizationId: scope.organizationId ?? null,
    displayName: input.title,
    tokenHash: hashToken(rawToken),
    expiresAt: inviteExpiresAt,
  });

  return {
    ...input,
    multiplayerGame: {
      ...input.multiplayerGame,
      inviteExpiresAt,
      joinTokenId: joinToken.id,
      inviteUrl: buildInviteUrl(options.multiplayerInviteBaseUrl, rawToken),
    },
  };
}

function preserveExistingInviteMetadata(
  input: NormalizedScheduledClassEventInput,
  existing: ScheduledClassEventRecord,
): NormalizedScheduledClassEventInput {
  if (
    !input.multiplayerGame ||
    !existing.multiplayerGame ||
    input.classroomId !== existing.classroomId
  ) {
    return input;
  }

  return {
    ...input,
    multiplayerGame: {
      ...input.multiplayerGame,
      joinTokenId: input.multiplayerGame.joinTokenId ?? existing.multiplayerGame.joinTokenId,
      inviteUrl: input.multiplayerGame.inviteUrl ?? existing.multiplayerGame.inviteUrl,
    },
  };
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
  options: { requireFutureStart?: boolean; multiplayerInviteBaseUrl?: string } = {},
): Promise<ScheduledClassEvent> {
  const normalized = normalizeScheduledClassInput(input, {
    requireFutureStart: options.requireFutureStart ?? true,
  });
  if (!normalized.ok) {
    throw new Error(normalized.error);
  }
  const eventInput = await ensureScheduledMultiplayerInvite(scope, normalized.value, options);

  const timestamp = new Date().toISOString();
  const record: ScheduledClassEventRecord = {
    id: randomUUID(),
    ownerUserId: scope.userId,
    organizationId: scope.organizationId ?? null,
    ...eventInput,
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
  options: { multiplayerInviteBaseUrl?: string } = {},
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

    const eventInput = await ensureScheduledMultiplayerInvite(
      scope,
      preserveExistingInviteMetadata(normalized.value, existing),
      options,
    );
    const updated = await upsertScheduledClassEventRecord({
      ...existing,
      title: eventInput.title,
      startsAt: eventInput.startsAt,
      durationMinutes: eventInput.durationMinutes,
      classroomId: eventInput.classroomId,
      multiplayerGame: eventInput.multiplayerGame,
      updatedAt: new Date().toISOString(),
    });
    return updated ? toClientEvent(updated) : null;
  }

  const store = await readPlatformStore();
  const existing = store.scheduledClassEvents.find((event) => event.id === id) ?? null;
  if (!existing || !canAccessEvent(existing, scope)) {
    return null;
  }

  const eventInput = await ensureScheduledMultiplayerInvite(
    scope,
    preserveExistingInviteMetadata(normalized.value, existing),
    options,
  );

  return updatePlatformStore((nextStore) => {
    const index = nextStore.scheduledClassEvents.findIndex((event) => event.id === id);
    if (index < 0 || !canAccessEvent(nextStore.scheduledClassEvents[index], scope)) {
      return null;
    }

    const updated: ScheduledClassEventRecord = {
      ...nextStore.scheduledClassEvents[index],
      title: eventInput.title,
      startsAt: eventInput.startsAt,
      durationMinutes: eventInput.durationMinutes,
      classroomId: eventInput.classroomId,
      multiplayerGame: eventInput.multiplayerGame,
      updatedAt: new Date().toISOString(),
    };
    nextStore.scheduledClassEvents[index] = updated;
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
