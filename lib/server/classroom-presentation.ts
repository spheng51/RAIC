import 'server-only';

import type { SessionRecord } from '@/lib/db/schema';
import { listRecentClassroomSessions } from '@/lib/db/repositories/sessions';
import { findUserById } from '@/lib/db/repositories/users';
import {
  readClassroom,
  updateClassroom,
  type PersistedClassroomData,
} from '@/lib/server/classroom-storage';
import { withMiroFishEmbedToken } from '@/lib/server/mirofish';
import type { SharedSimulation } from '@/lib/types/stage';

export interface ClassroomPresentationParticipant {
  sessionId: string;
  userId: string;
  displayName: string;
  role: SessionRecord['role'];
  lastSeenAt: string;
  isController: boolean;
}

export interface ClassroomPresentationSnapshot {
  classroom: PersistedClassroomData;
  sharedSimulation: SharedSimulation | null;
  participants: ClassroomPresentationParticipant[];
  reportAvailable: boolean;
  runUrl: string | null;
  reportUrl: string | null;
}

export function resetSharedSimulationControl(sharedSimulation: SharedSimulation): SharedSimulation {
  return {
    ...sharedSimulation,
    controllerSessionId: undefined,
    controllerRole: 'teacher',
    controlLeaseExpiresAt: undefined,
  };
}

export function hasStudentControlLease(sharedSimulation: SharedSimulation | null): boolean {
  if (!sharedSimulation || sharedSimulation.controllerRole !== 'student') {
    return false;
  }

  if (!sharedSimulation.controllerSessionId || !sharedSimulation.controlLeaseExpiresAt) {
    return false;
  }

  const leaseExpiry = new Date(sharedSimulation.controlLeaseExpiresAt).getTime();
  return !Number.isNaN(leaseExpiry) && leaseExpiry > Date.now();
}

export function canSessionControlPresentation(
  sharedSimulation: SharedSimulation | null,
  session: SessionRecord,
): boolean {
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

  if (sharedSimulation.controllerRole === 'teacher') {
    return session.kind === 'web' && session.role !== 'student';
  }

  return (
    hasStudentControlLease(sharedSimulation) &&
    sharedSimulation.controllerSessionId === session.id
  );
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
      sharedSimulation?.controllerRole === 'student' &&
      sharedSimulation.controllerSessionId === session.id,
  }));
}

export async function getClassroomPresentationSnapshot(
  classroomId: string,
): Promise<ClassroomPresentationSnapshot | null> {
  let classroom = await readClassroom(classroomId);
  if (!classroom) {
    return null;
  }

  let sharedSimulation = classroom.stage.sharedSimulation ?? null;
  let participants = await listClassroomPresentationParticipants(classroomId, sharedSimulation);

  if (sharedSimulation?.controllerRole === 'student') {
    const activeSessionIds = new Set(participants.map((participant) => participant.sessionId));
    if (
      !hasStudentControlLease(sharedSimulation) ||
      !sharedSimulation.controllerSessionId ||
      !activeSessionIds.has(sharedSimulation.controllerSessionId)
    ) {
      const normalized = resetSharedSimulationControl(sharedSimulation);
      const updated = await updateClassroom(classroomId, (current) => ({
        ...current,
        stage: {
          ...current.stage,
          sharedSimulation: normalized,
        },
      }));

      if (updated) {
        classroom = updated;
        sharedSimulation = normalized;
        participants = await listClassroomPresentationParticipants(classroomId, sharedSimulation);
      }
    }
  }

  const runUrl = sharedSimulation
    ? withMiroFishEmbedToken(sharedSimulation.runUrl, {
        classroomId,
        simulationId: sharedSimulation.simulationId,
        reportId: sharedSimulation.reportId,
      })
    : null;
  const reportUrl =
    sharedSimulation?.reportUrl && sharedSimulation.reportId
      ? withMiroFishEmbedToken(sharedSimulation.reportUrl, {
          classroomId,
          simulationId: sharedSimulation.simulationId,
          reportId: sharedSimulation.reportId,
        })
      : null;

  return {
    classroom,
    sharedSimulation,
    participants,
    reportAvailable: Boolean(sharedSimulation?.reportId && sharedSimulation.reportUrl),
    runUrl,
    reportUrl,
  };
}
