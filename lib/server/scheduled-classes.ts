import 'server-only';

import { randomUUID } from 'crypto';
import { createOpaqueToken, hashToken } from '@/lib/auth/session';
import { isPostgresConfigured, readPlatformStore, updatePlatformStore } from '@/lib/db/client';
import {
  createJoinTokenRecord,
  updateJoinTokenExpiration,
} from '@/lib/db/repositories/join-tokens';
import {
  claimDiscordScheduledClassReminderRecord,
  deleteScheduledClassEventRecord,
  finalizeDiscordScheduledClassReminderRecord,
  listDiscordSyncedScheduledClassEventRecords,
  listScheduledClassEventRecordsForAccess,
  readScheduledClassEventRecord,
  releaseDiscordScheduledClassReminderClaimRecord,
  upsertScheduledClassEventRecord,
} from '@/lib/db/repositories/scheduled-classes';
import {
  listDiscordConnectionsForUser,
  readDiscordConnectionForUser,
} from '@/lib/db/repositories/discord-connections';
import type {
  DiscordConnectionRecord,
  PlatformRole,
  ScheduledClassEventRecord,
} from '@/lib/db/schema';
import type { ScheduledClassEvent, ScheduledClassEventInput } from '@/lib/types/scheduled-classes';
import { readClassroom } from '@/lib/server/classroom-storage';
import {
  createDiscordScheduledEvent,
  deleteDiscordScheduledEvent,
  DiscordApiError,
  normalizeDiscordError,
  sendDiscordChannelMessage,
  updateDiscordScheduledEvent,
  type DiscordScheduledEventPayload,
} from '@/lib/server/discord';
import {
  getScheduledClassInviteExpiresAt,
  normalizeScheduledClassInput,
  sortScheduledClassEvents,
  type NormalizedScheduledClassEventInput,
} from '@/lib/utils/scheduled-classes';

const DISCORD_REMINDER_CLAIM_STALE_MS = 15 * 60 * 1000;

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

function addMinutes(isoDate: string, minutes: number) {
  return new Date(new Date(isoDate).getTime() + minutes * 60 * 1000).toISOString();
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

function preserveDiscordSyncForScheduleUpdate(
  eventInput: NormalizedScheduledClassEventInput,
  existing: ScheduledClassEventRecord,
): ScheduledClassEventRecord['discordSync'] {
  if (!existing.discordSync) {
    return undefined;
  }

  if (eventInput.startsAt === existing.startsAt) {
    return existing.discordSync;
  }

  const {
    reminderClaimedAt: _reminderClaimedAt,
    reminderMessageId: _reminderMessageId,
    reminderSentAt: _reminderSentAt,
    ...sync
  } = existing.discordSync;
  return sync;
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
      discordSync: preserveDiscordSyncForScheduleUpdate(eventInput, existing),
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
      discordSync: preserveDiscordSyncForScheduleUpdate(
        eventInput,
        nextStore.scheduledClassEvents[index],
      ),
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
    await deleteDiscordScheduledEventIfPresent(existing);
    return deleteScheduledClassEventRecord(id);
  }

  const store = await readPlatformStore();
  const existing = store.scheduledClassEvents.find((event) => event.id === id) ?? null;
  if (!existing || !canAccessEvent(existing, scope)) {
    return false;
  }
  await deleteDiscordScheduledEventIfPresent(existing);

  return updatePlatformStore((nextStore) => {
    const index = nextStore.scheduledClassEvents.findIndex((event) => event.id === id);
    if (index < 0 || !canAccessEvent(nextStore.scheduledClassEvents[index], scope)) {
      return false;
    }
    nextStore.scheduledClassEvents.splice(index, 1);
    return true;
  });
}

function isDiscordScheduledEventAlreadyDeleted(error: unknown) {
  return (
    error instanceof DiscordApiError &&
    (error.status === 404 || /unknown scheduled event/i.test(error.responseText ?? ''))
  );
}

async function deleteDiscordScheduledEventIfPresent(event: ScheduledClassEventRecord) {
  const guildId = event.discordSync?.guildId;
  const scheduledEventId = event.discordSync?.scheduledEventId;
  if (!guildId || !scheduledEventId) return;

  try {
    await deleteDiscordScheduledEvent(guildId, scheduledEventId);
  } catch (error) {
    if (isDiscordScheduledEventAlreadyDeleted(error)) {
      return;
    }
    throw new Error(`Failed to delete Discord scheduled event. ${normalizeDiscordError(error)}`);
  }
}

async function writeDiscordScheduledEvent(input: {
  guildId: string;
  scheduledEventId?: string;
  payload: DiscordScheduledEventPayload;
}) {
  if (input.scheduledEventId) {
    try {
      return await updateDiscordScheduledEvent(
        input.guildId,
        input.scheduledEventId,
        input.payload,
      );
    } catch (error) {
      if (!isDiscordScheduledEventAlreadyDeleted(error)) {
        throw error;
      }
    }
  }

  return createDiscordScheduledEvent(input.guildId, input.payload);
}

async function updateScheduledClassRecord(
  event: ScheduledClassEventRecord,
): Promise<ScheduledClassEventRecord | null> {
  if (isPostgresConfigured()) {
    return upsertScheduledClassEventRecord(event);
  }

  return updatePlatformStore((store) => {
    const index = store.scheduledClassEvents.findIndex((item) => item.id === event.id);
    if (index < 0) return null;
    store.scheduledClassEvents[index] = event;
    return event;
  });
}

async function readScheduledClassForAccess(
  scope: ScheduledClassAccessScope,
  id: string,
): Promise<ScheduledClassEventRecord | null> {
  if (isPostgresConfigured()) {
    const event = await readScheduledClassEventRecord(id);
    return event && canAccessEvent(event, scope) ? event : null;
  }

  const store = await readPlatformStore();
  const event = store.scheduledClassEvents.find((item) => item.id === id) ?? null;
  return event && canAccessEvent(event, scope) ? event : null;
}

async function ensureDiscordInvite(
  scope: ScheduledClassAccessScope,
  event: ScheduledClassEventRecord,
  baseUrl: string,
): Promise<{
  joinTokenId?: string;
  inviteUrl: string;
}> {
  const multiplayerInvite = event.multiplayerGame?.inviteUrl;
  if (multiplayerInvite) {
    return {
      joinTokenId: event.multiplayerGame?.joinTokenId,
      inviteUrl: multiplayerInvite,
    };
  }

  if (!event.classroomId) {
    throw new Error('Choose a classroom before syncing this scheduled class with Discord.');
  }

  const expiresAt = getScheduledClassInviteExpiresAt({
    startsAt: event.startsAt,
    durationMinutes: event.durationMinutes,
  });

  if (event.discordSync?.joinTokenId && event.discordSync.inviteUrl) {
    const refreshed = await updateJoinTokenExpiration(event.discordSync.joinTokenId, expiresAt);
    if (refreshed) {
      return {
        joinTokenId: event.discordSync.joinTokenId,
        inviteUrl: event.discordSync.inviteUrl,
      };
    }
  }

  const rawToken = createOpaqueToken();
  const joinToken = await createJoinTokenRecord({
    classroomId: event.classroomId,
    createdByUserId: scope.userId,
    organizationId: scope.organizationId ?? null,
    displayName: event.title,
    tokenHash: hashToken(rawToken),
    expiresAt,
  });

  return {
    joinTokenId: joinToken.id,
    inviteUrl: buildInviteUrl(baseUrl, rawToken),
  };
}

export function buildDiscordScheduledClassPayload(input: {
  event: ScheduledClassEventRecord;
  inviteUrl: string;
  classroomName?: string | null;
}): DiscordScheduledEventPayload {
  const startsAt = new Date(input.event.startsAt).toISOString();
  const scheduledEndTime = addMinutes(input.event.startsAt, input.event.durationMinutes ?? 60);
  const description = [
    input.classroomName ? `Classroom: ${input.classroomName}` : null,
    `Join: ${input.inviteUrl}`,
    input.event.multiplayerGame?.enabled ? 'Multiplayer Game Mode' : null,
  ]
    .filter(Boolean)
    .join('\n');

  return {
    name: input.event.title,
    description,
    scheduled_start_time: startsAt,
    scheduled_end_time: scheduledEndTime,
    privacy_level: 2,
    entity_type: 3,
    entity_metadata: { location: 'Open RAIC classroom' },
  };
}

function buildDiscordScheduledEventUrl(guildId: string, eventId: string) {
  return `https://discord.com/events/${guildId}/${eventId}`;
}

function getScheduledClassOrganizationId(event: ScheduledClassEventRecord) {
  return event.organizationId ?? null;
}

function isDiscordConnectionForScheduledClass(
  event: ScheduledClassEventRecord,
  connection: DiscordConnectionRecord,
) {
  return connection.organizationId === getScheduledClassOrganizationId(event);
}

async function selectDefaultDiscordConnectionForScheduledClass(
  scope: ScheduledClassAccessScope,
  event: ScheduledClassEventRecord,
) {
  const connections = await listDiscordConnectionsForUser(scope.userId);
  const connection =
    connections.find((item) => isDiscordConnectionForScheduledClass(event, item)) ?? null;
  if (!connection && connections.length > 0) {
    throw new Error('Connect Discord for this organization before syncing this scheduled class.');
  }
  return connection;
}

export async function syncScheduledClassDiscordForAccess(
  scope: ScheduledClassAccessScope,
  id: string,
  options: { baseUrl: string; connectionId?: string } = { baseUrl: '' },
): Promise<ScheduledClassEvent | null> {
  const event = await readScheduledClassForAccess(scope, id);
  if (!event) return null;
  if (!event.organizationId && scope.organizationId) {
    throw new Error('Assign this scheduled class to an organization before syncing with Discord.');
  }

  let connection: Awaited<ReturnType<typeof readDiscordConnectionForUser>> = null;
  if (options.connectionId) {
    connection = await readDiscordConnectionForUser(scope.userId, options.connectionId);
  } else if (event.discordSync?.connectionId) {
    connection = await readDiscordConnectionForUser(scope.userId, event.discordSync.connectionId);
    if (!connection) {
      throw new Error('Reconnect Discord before syncing this scheduled class.');
    }
  } else if (event.discordSync?.enabled) {
    throw new Error('Reconnect Discord before syncing this scheduled class.');
  } else {
    connection = await selectDefaultDiscordConnectionForScheduledClass(scope, event);
  }
  if (!connection) {
    throw new Error('Connect Discord before syncing this scheduled class.');
  }
  if (!isDiscordConnectionForScheduledClass(event, connection)) {
    throw new Error('Connect Discord for this organization before syncing this scheduled class.');
  }
  if (!connection.channelId) {
    throw new Error('Choose a Discord announcement channel before syncing this scheduled class.');
  }

  const invite = await ensureDiscordInvite(scope, event, options.baseUrl);
  const classroom = event.classroomId ? await readClassroom(event.classroomId) : null;
  const payload = buildDiscordScheduledClassPayload({
    event,
    inviteUrl: invite.inviteUrl,
    classroomName: classroom?.stage.name,
  });

  try {
    const syncedEvent = await writeDiscordScheduledEvent({
      guildId: connection.guildId,
      scheduledEventId: event.discordSync?.scheduledEventId,
      payload,
    });
    const scheduledEventId = syncedEvent.id;
    const now = new Date().toISOString();
    const updated: ScheduledClassEventRecord = {
      ...event,
      discordSync: {
        enabled: true,
        connectionId: connection.id,
        guildId: connection.guildId,
        guildName: connection.guildName,
        channelId: connection.channelId,
        channelName: connection.channelName ?? undefined,
        joinTokenId: invite.joinTokenId,
        inviteUrl: invite.inviteUrl,
        scheduledEventId,
        scheduledEventUrl:
          syncedEvent.url ?? buildDiscordScheduledEventUrl(connection.guildId, scheduledEventId),
        lastSyncedAt: now,
      },
      updatedAt: now,
    };
    const saved = await updateScheduledClassRecord(updated);
    return saved ? toClientEvent(saved) : null;
  } catch (error) {
    const warning = normalizeDiscordError(error);
    const now = new Date().toISOString();
    await updateScheduledClassRecord({
      ...event,
      discordSync: {
        ...event.discordSync,
        enabled: true,
        connectionId: connection.id,
        guildId: connection.guildId,
        guildName: connection.guildName,
        channelId: connection.channelId,
        channelName: connection.channelName ?? undefined,
        joinTokenId: invite.joinTokenId,
        inviteUrl: invite.inviteUrl,
        syncWarning: warning,
      },
      updatedAt: now,
    });
    throw new Error(warning);
  }
}

async function listDiscordSyncedEvents(): Promise<ScheduledClassEventRecord[]> {
  if (isPostgresConfigured()) {
    return listDiscordSyncedScheduledClassEventRecords();
  }

  const store = await readPlatformStore();
  return store.scheduledClassEvents.filter((event) => event.discordSync?.enabled);
}

function isDiscordReminderClaimActive(event: ScheduledClassEventRecord, now: Date) {
  const claimedAt = event.discordSync?.reminderClaimedAt;
  if (!claimedAt) return false;
  const claimedTime = new Date(claimedAt).getTime();
  if (Number.isNaN(claimedTime)) return false;
  return now.getTime() - claimedTime < DISCORD_REMINDER_CLAIM_STALE_MS;
}

function getDiscordReminderStaleClaimBefore(now: Date) {
  return new Date(now.getTime() - DISCORD_REMINDER_CLAIM_STALE_MS).toISOString();
}

function isScheduledClassDueForReminder(
  event: ScheduledClassEventRecord,
  now: Date,
  latestReminderTime: number,
) {
  const startsAt = new Date(event.startsAt).getTime();
  return (
    !Number.isNaN(startsAt) &&
    startsAt >= now.getTime() &&
    startsAt <= latestReminderTime &&
    !event.discordSync?.reminderSentAt &&
    !isDiscordReminderClaimActive(event, now) &&
    Boolean(event.discordSync?.channelId) &&
    Boolean(event.discordSync?.inviteUrl)
  );
}

async function claimDiscordReminderForSend(
  event: ScheduledClassEventRecord,
  now: Date,
  latestReminderTime: number,
) {
  const claimedAt = now.toISOString();
  const staleClaimBefore = getDiscordReminderStaleClaimBefore(now);

  if (isPostgresConfigured()) {
    return claimDiscordScheduledClassReminderRecord({
      id: event.id,
      claimedAt,
      latestReminderAt: new Date(latestReminderTime).toISOString(),
      now: claimedAt,
      staleClaimBefore,
    });
  }

  return updatePlatformStore((store) => {
    const index = store.scheduledClassEvents.findIndex((item) => item.id === event.id);
    if (index < 0) return null;

    const current = store.scheduledClassEvents[index];
    if (
      !current.discordSync?.enabled ||
      !isScheduledClassDueForReminder(current, now, latestReminderTime)
    ) {
      return null;
    }

    const {
      reminderMessageId: _reminderMessageId,
      syncWarning: _syncWarning,
      ...sync
    } = current.discordSync;
    const updated: ScheduledClassEventRecord = {
      ...current,
      discordSync: {
        ...sync,
        reminderClaimedAt: claimedAt,
      },
      updatedAt: claimedAt,
    };
    store.scheduledClassEvents[index] = updated;
    return updated;
  });
}

async function finalizeDiscordReminderSend(
  event: ScheduledClassEventRecord,
  sentAt: string,
  messageId: string,
) {
  const claimedAt = event.discordSync?.reminderClaimedAt;
  if (!claimedAt) return null;

  if (isPostgresConfigured()) {
    return finalizeDiscordScheduledClassReminderRecord({
      id: event.id,
      claimedAt,
      messageId,
      sentAt,
    });
  }

  return updatePlatformStore((store) => {
    const index = store.scheduledClassEvents.findIndex((item) => item.id === event.id);
    if (index < 0) return null;

    const current = store.scheduledClassEvents[index];
    if (
      current.discordSync?.reminderClaimedAt !== claimedAt ||
      current.discordSync.reminderSentAt
    ) {
      return null;
    }

    const {
      reminderClaimedAt: _reminderClaimedAt,
      syncWarning: _syncWarning,
      ...sync
    } = current.discordSync;
    const updated: ScheduledClassEventRecord = {
      ...current,
      discordSync: {
        ...sync,
        reminderSentAt: sentAt,
        reminderMessageId: messageId,
      },
      updatedAt: sentAt,
    };
    store.scheduledClassEvents[index] = updated;
    return updated;
  });
}

async function releaseDiscordReminderClaim(
  event: ScheduledClassEventRecord,
  releasedAt: string,
  syncWarning: string,
) {
  const claimedAt = event.discordSync?.reminderClaimedAt;
  if (!claimedAt) return null;

  if (isPostgresConfigured()) {
    return releaseDiscordScheduledClassReminderClaimRecord({
      id: event.id,
      claimedAt,
      releasedAt,
      syncWarning,
    });
  }

  return updatePlatformStore((store) => {
    const index = store.scheduledClassEvents.findIndex((item) => item.id === event.id);
    if (index < 0) return null;

    const current = store.scheduledClassEvents[index];
    if (
      current.discordSync?.reminderClaimedAt !== claimedAt ||
      current.discordSync.reminderSentAt
    ) {
      return null;
    }

    const {
      reminderClaimedAt: _reminderClaimedAt,
      reminderMessageId: _reminderMessageId,
      reminderSentAt: _reminderSentAt,
      ...sync
    } = current.discordSync;
    const updated: ScheduledClassEventRecord = {
      ...current,
      discordSync: {
        ...sync,
        syncWarning,
      },
      updatedAt: releasedAt,
    };
    store.scheduledClassEvents[index] = updated;
    return updated;
  });
}

export async function sendDueDiscordScheduledClassReminders(
  options: { now?: Date; leadMinutes?: number } = {},
): Promise<{ checked: number; sent: number; failed: number }> {
  const now = options.now ?? new Date();
  const leadMinutes = options.leadMinutes ?? 10;
  const latestReminderTime = now.getTime() + leadMinutes * 60 * 1000;
  const events = await listDiscordSyncedEvents();
  let checked = 0;
  let sent = 0;
  let failed = 0;

  for (const event of events) {
    if (!isScheduledClassDueForReminder(event, now, latestReminderTime)) {
      continue;
    }

    const claimedEvent = await claimDiscordReminderForSend(event, now, latestReminderTime);
    if (!claimedEvent?.discordSync?.channelId || !claimedEvent.discordSync.inviteUrl) {
      continue;
    }

    checked += 1;
    try {
      const message = await sendDiscordChannelMessage(claimedEvent.discordSync.channelId, {
        content: `Upcoming class: ${claimedEvent.title}\n${claimedEvent.discordSync.inviteUrl}`,
      });
      await finalizeDiscordReminderSend(claimedEvent, now.toISOString(), message.id);
      sent += 1;
    } catch (error) {
      failed += 1;
      await releaseDiscordReminderClaim(
        claimedEvent,
        now.toISOString(),
        normalizeDiscordError(error),
      );
    }
  }

  return { checked, sent, failed };
}
