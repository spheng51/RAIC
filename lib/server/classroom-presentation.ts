import 'server-only';

import type { SessionRecord } from '@/lib/db/schema';
import { listRecentClassroomSessions } from '@/lib/db/repositories/sessions';
import { findUserById } from '@/lib/db/repositories/users';
import {
  readClassroom,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';
import { withMiroFishEmbedToken } from '@/lib/server/mirofish';
import type {
  ClassroomPresentationParticipant,
  ClassroomPresentationStatePayload,
} from '@/lib/types/classroom-presentation';
import type { SharedSimulation } from '@/lib/types/stage';
import {
  canSessionInteractWithSharedSimulation,
  getSharedSimulationCollaborationMode,
  getSharedSimulationFingerprint,
  getStageSharedSimulation,
  hasAttachedSharedSimulation,
  hasSharedSimulationReport,
  hasStudentControlLease,
  normalizeSharedSimulationState,
  resetSharedSimulationControl,
} from '@/lib/utils/classroom-presentation';

export interface ClassroomPresentationSnapshot {
  classroom: PersistedClassroomData;
  sharedSimulation: SharedSimulation | null;
  participants: ClassroomPresentationParticipant[];
  reportAvailable: boolean;
  runUrl: string | null;
  reportUrl: string | null;
}
export { hasStudentControlLease, resetSharedSimulationControl };

export function canSessionControlPresentation(
  sharedSimulation: SharedSimulation | null,
  session: SessionRecord,
): boolean {
  if (getSharedSimulationCollaborationMode(sharedSimulation) === 'multi-user') {
    return session.kind === 'web' && session.role !== 'student';
  }

  if (session.kind === 'web' && session.role !== 'student') {
    return true;
  }

  return (
    !!sharedSimulation &&
    hasStudentControlLease(sharedSimulation) &&
    sharedSimulation.controllerSessionId === session.id
  );
}

export function doesSessionOwnSimulationControl(
  sharedSimulation: SharedSimulation | null,
  session: SessionRecord,
): boolean {
  if (!sharedSimulation) {
    return false;
  }

  if (getSharedSimulationCollaborationMode(sharedSimulation) === 'multi-user') {
    return canSessionInteractWithSharedSimulation(sharedSimulation, session);
  }

  if (sharedSimulation.controllerRole === 'teacher') {
    return session.kind === 'web' && session.role !== 'student';
  }

  return (
    hasStudentControlLease(sharedSimulation) && sharedSimulation.controllerSessionId === session.id
  );
}

export function canSessionManageSimulation(session: SessionRecord): boolean {
  return session.kind === 'web' && session.role !== 'student';
}

async function listClassroomPresentationParticipants(
  classroomId: string,
  sharedSimulation: SharedSimulation | null,
): Promise<ClassroomPresentationParticipant[]> {
  const sessions = await listRecentClassroomSessions(classroomId);
  const users = await Promise.all(sessions.map((session) => findUserById(session.userId)));

  return sessions.map((session, index) => ({
    sessionId: session.id,
    userId: session.userId,
    displayName: users[index]?.displayName || 'Student',
    role: session.role,
    lastSeenAt: session.lastSeenAt,
    isController:
      getSharedSimulationCollaborationMode(sharedSimulation) === 'single-controller' &&
      sharedSimulation?.controllerRole === 'student' &&
      sharedSimulation.controllerSessionId === session.id,
  }));
}

export async function getClassroomPresentationSnapshot(
  classroomId: string,
): Promise<ClassroomPresentationSnapshot | null> {
  const classroom = await readClassroom(classroomId);
  if (!classroom) {
    return null;
  }

  const sharedSimulation = getStageSharedSimulation(classroom.stage);
  const participants = await listClassroomPresentationParticipants(classroomId, sharedSimulation);
  const normalizedSharedSimulation = normalizeSharedSimulationState(
    sharedSimulation,
    participants.map((participant) => participant.sessionId),
  );

  const runUrl = hasAttachedSharedSimulation(normalizedSharedSimulation)
    ? withMiroFishEmbedToken(normalizedSharedSimulation.runUrl, {
        classroomId,
        simulationId: normalizedSharedSimulation.simulationId,
        reportId: normalizedSharedSimulation.reportId,
      })
    : null;
  const reportUrl =
    normalizedSharedSimulation?.reportUrl && normalizedSharedSimulation.reportId
      ? withMiroFishEmbedToken(normalizedSharedSimulation.reportUrl, {
          classroomId,
          simulationId: normalizedSharedSimulation.simulationId,
          reportId: normalizedSharedSimulation.reportId,
        })
      : null;

  return {
    classroom,
    sharedSimulation: normalizedSharedSimulation,
    participants,
    reportAvailable: hasSharedSimulationReport(normalizedSharedSimulation),
    runUrl,
    reportUrl,
  };
}

export function buildClassroomPresentationStatePayload(
  snapshot: ClassroomPresentationSnapshot,
  session: SessionRecord,
): ClassroomPresentationStatePayload {
  const viewerCanManageSimulation = canSessionManageSimulation(session);
  const viewerCanControlPresentation = canSessionControlPresentation(
    snapshot.sharedSimulation,
    session,
  );
  const viewerHasSimulationControl = doesSessionOwnSimulationControl(
    snapshot.sharedSimulation,
    session,
  );

  return {
    roomVersion: snapshot.classroom.roomVersion,
    activeSurface: snapshot.sharedSimulation?.activeSurface ?? 'lesson',
    controllerSessionId: snapshot.sharedSimulation?.controllerSessionId ?? null,
    controllerRole: snapshot.sharedSimulation?.controllerRole ?? 'teacher',
    controlLeaseExpiresAt: snapshot.sharedSimulation?.controlLeaseExpiresAt ?? null,
    simulationStatus: snapshot.sharedSimulation?.status ?? null,
    reportAvailable: hasSharedSimulationReport(snapshot.sharedSimulation),
    sharedSimulation: snapshot.sharedSimulation
      ? {
          ...snapshot.sharedSimulation,
          runUrl: snapshot.runUrl ?? snapshot.sharedSimulation.runUrl,
          reportUrl: snapshot.reportUrl ?? snapshot.sharedSimulation.reportUrl,
        }
      : null,
    runUrl: snapshot.runUrl,
    reportUrl: snapshot.reportUrl,
    viewerSessionId: session.id,
    viewerRole: session.role,
    viewerKind: session.kind,
    viewerCanManageSimulation,
    viewerCanControlPresentation,
    viewerHasSimulationControl,
    participants: snapshot.participants,
  };
}

export function getClassroomPresentationFingerprint(
  payload: ClassroomPresentationStatePayload,
): string {
  return JSON.stringify({
    activeSurface: payload.activeSurface,
    controllerSessionId: payload.controllerSessionId,
    controllerRole: payload.controllerRole,
    controlLeaseExpiresAt: payload.controlLeaseExpiresAt,
    simulationStatus: payload.simulationStatus,
    reportAvailable: payload.reportAvailable,
    runUrl: payload.runUrl,
    reportUrl: payload.reportUrl,
    sharedSimulation: getSharedSimulationFingerprint(payload.sharedSimulation),
    viewerSessionId: payload.viewerSessionId,
    viewerRole: payload.viewerRole,
    viewerKind: payload.viewerKind,
    viewerCanManageSimulation: payload.viewerCanManageSimulation,
    viewerCanControlPresentation: payload.viewerCanControlPresentation,
    viewerHasSimulationControl: payload.viewerHasSimulationControl,
    participants: payload.participants.map((participant) => ({
      sessionId: participant.sessionId,
      userId: participant.userId,
      displayName: participant.displayName,
      role: participant.role,
      isController: participant.isController,
    })),
  });
}
