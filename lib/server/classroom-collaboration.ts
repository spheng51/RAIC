import 'server-only';

import type { SessionRecord } from '@/lib/db/schema';
import { listRecentClassroomSessions } from '@/lib/db/repositories/sessions';
import { findUserById } from '@/lib/db/repositories/users';
import {
  readClassroom,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';
import { isMiroFishMultiUserEnabled } from '@/lib/server/mirofish';
import type {
  ClassroomCollaborationParticipant,
  ClassroomCollaborationStatePayload,
} from '@/lib/types/classroom-collaboration';
import type { SharedSimulation } from '@/lib/types/stage';
import {
  canSessionInteractWithSharedSimulation,
  getSharedSimulationCollaborationMode,
  getSharedSimulationCollaborationState,
  getSharedSimulationInteractionReason,
  getSharedSimulationRemovedSessionIds,
  getStageSharedSimulation,
  normalizeSharedSimulationState,
} from '@/lib/utils/classroom-presentation';

export interface ClassroomCollaborationSnapshot {
  classroom: PersistedClassroomData;
  sharedSimulation: SharedSimulation | null;
  participants: ClassroomCollaborationParticipant[];
}

export function canSessionModerateCollaboration(session: SessionRecord) {
  return session.kind === 'web' && session.role !== 'student';
}

function buildClassroomCollaborationParticipants(
  sessions: SessionRecord[],
  users: Awaited<ReturnType<typeof findUserById>>[],
  sharedSimulation: SharedSimulation | null,
): ClassroomCollaborationParticipant[] {
  const removedSessionIds = new Set(getSharedSimulationRemovedSessionIds(sharedSimulation));
  const collaborationState = getSharedSimulationCollaborationState(sharedSimulation);
  const allowStudentInteraction = sharedSimulation?.allowStudentInteraction !== false;

  return sessions.map((session, index) => {
    const isRemoved = removedSessionIds.has(session.id);
    const isSpotlighted = sharedSimulation?.spotlightSessionId === session.id;
    const canInteract =
      getSharedSimulationCollaborationMode(sharedSimulation) === 'multi-user'
        ? !isRemoved && collaborationState === 'live' && allowStudentInteraction
        : sharedSimulation?.controllerRole === 'student' &&
          sharedSimulation.controllerSessionId === session.id;

    return {
      sessionId: session.id,
      userId: session.userId,
      displayName: users[index]?.displayName || 'Student',
      role: session.role,
      lastSeenAt: session.lastSeenAt,
      isRemoved,
      isSpotlighted,
      canInteract,
    };
  });
}

export async function getClassroomCollaborationSnapshot(
  classroomId: string,
): Promise<ClassroomCollaborationSnapshot | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return null;
  }

  const sharedSimulation = getStageSharedSimulation(classroom.stage);
  const sessions = await listRecentClassroomSessions(classroomId);
  const users = await Promise.all(sessions.map((session) => findUserById(session.userId)));
  let nextSharedSimulation = normalizeSharedSimulationState(
    sharedSimulation,
    sessions.map((session) => session.id),
  );
  const participants = buildClassroomCollaborationParticipants(sessions, users, nextSharedSimulation);

  if (
    nextSharedSimulation &&
    getSharedSimulationCollaborationMode(nextSharedSimulation) === 'multi-user' &&
    (nextSharedSimulation.participantCount !== participants.length ||
      !nextSharedSimulation.lastCollaborationSyncAt)
  ) {
    nextSharedSimulation = {
      ...nextSharedSimulation,
      participantCount: participants.length,
      lastCollaborationSyncAt: new Date().toISOString(),
    };
  }

  return {
    classroom,
    sharedSimulation: nextSharedSimulation,
    participants,
  };
}

export function buildClassroomCollaborationStatePayload(
  snapshot: ClassroomCollaborationSnapshot,
  session: SessionRecord,
): ClassroomCollaborationStatePayload {
  const collaborationMode = getSharedSimulationCollaborationMode(snapshot.sharedSimulation);
  const viewerCanModerateCollaboration = canSessionModerateCollaboration(session);
  const viewerIsRemoved = getSharedSimulationRemovedSessionIds(snapshot.sharedSimulation).includes(
    session.id,
  );

  return {
    roomVersion: snapshot.classroom.roomVersion,
    collaborationMode,
    collaborationState: getSharedSimulationCollaborationState(snapshot.sharedSimulation),
    allowStudentInteraction: snapshot.sharedSimulation?.allowStudentInteraction !== false,
    spotlightSessionId: snapshot.sharedSimulation?.spotlightSessionId ?? null,
    participantCount: snapshot.participants.length,
    participants: snapshot.participants,
    mirofishSessionId: snapshot.sharedSimulation?.mirofishSessionId ?? null,
    lastCollaborationSyncAt: snapshot.sharedSimulation?.lastCollaborationSyncAt ?? null,
    viewerSessionId: session.id,
    viewerRole: session.role,
    viewerKind: session.kind,
    viewerCanModerateCollaboration,
    viewerCanInteract:
      collaborationMode === 'multi-user'
        ? canSessionInteractWithSharedSimulation(snapshot.sharedSimulation, session)
        : false,
    viewerIsRemoved,
    viewerInteractionReason:
      collaborationMode === 'multi-user'
        ? getSharedSimulationInteractionReason(snapshot.sharedSimulation, session)
        : null,
    multiUserEnabled: isMiroFishMultiUserEnabled(),
  };
}

export function getClassroomCollaborationFingerprint(
  payload: ClassroomCollaborationStatePayload,
): string {
  return JSON.stringify({
    collaborationMode: payload.collaborationMode,
    collaborationState: payload.collaborationState,
    allowStudentInteraction: payload.allowStudentInteraction,
    spotlightSessionId: payload.spotlightSessionId,
    participantCount: payload.participantCount,
    mirofishSessionId: payload.mirofishSessionId,
    lastCollaborationSyncAt: payload.lastCollaborationSyncAt,
    viewerSessionId: payload.viewerSessionId,
    viewerCanModerateCollaboration: payload.viewerCanModerateCollaboration,
    viewerCanInteract: payload.viewerCanInteract,
    viewerIsRemoved: payload.viewerIsRemoved,
    viewerInteractionReason: payload.viewerInteractionReason,
    participants: payload.participants.map((participant) => ({
      sessionId: participant.sessionId,
      userId: participant.userId,
      displayName: participant.displayName,
      role: participant.role,
      isRemoved: participant.isRemoved,
      isSpotlighted: participant.isSpotlighted,
      canInteract: participant.canInteract,
    })),
  });
}
