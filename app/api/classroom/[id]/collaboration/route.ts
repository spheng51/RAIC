import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { createLogger } from '@/lib/logger';
import {
  buildClassroomCollaborationStatePayload,
  getClassroomCollaborationSnapshot,
} from '@/lib/server/classroom-collaboration';
import {
  buildClassroomRoomEventActor,
  recordClassroomRoomEvent,
} from '@/lib/server/classroom-room-events';
import { recordAuditEvent } from '@/lib/server/audit-log';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { isMiroFishMultiUserEnabled } from '@/lib/server/mirofish';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';
import type { ClassroomCollaborationAction } from '@/lib/types/classroom-collaboration';
import { getSharedSimulationCollaborationMode } from '@/lib/utils/classroom-presentation';

interface CollaborationBody {
  action?: ClassroomCollaborationAction;
  targetSessionId?: string;
}

const log = createLogger('Classroom MiroFish Collaboration');

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

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

  if (!isMiroFishMultiUserEnabled()) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'MiroFish multi-user mode is not enabled for this deployment',
    );
  }

  const snapshot = await getClassroomCollaborationSnapshot(id);
  if (!snapshot) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  if (!snapshot.sharedSimulation) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'No MiroFish simulation is attached',
    );
  }

  if (getSharedSimulationCollaborationMode(snapshot.sharedSimulation) !== 'multi-user') {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'This classroom is still using single-controller MiroFish mode',
    );
  }

  const body = ((await request.json().catch(() => ({}))) ?? {}) as CollaborationBody;
  const action = body.action;
  const targetSessionId = body.targetSessionId?.trim();

  if (
    action !== 'freeze' &&
    action !== 'unfreeze' &&
    action !== 'open' &&
    action !== 'close' &&
    action !== 'reset_session' &&
    action !== 'spotlight' &&
    action !== 'clear_spotlight' &&
    action !== 'remove_participant'
  ) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid collaboration action',
    );
  }

  if ((action === 'spotlight' || action === 'remove_participant') && !targetSessionId) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'targetSessionId is required for this collaboration action',
    );
  }

  if (targetSessionId) {
    const targetParticipant = snapshot.participants.find(
      (participant) => participant.sessionId === targetSessionId,
    );
    if (!targetParticipant) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'targetSessionId must match an active classroom session',
      );
    }
  }

  const updated = await updateClassroom(id, (current) => {
    const sharedSimulation = current.stage.sharedSimulation;
    if (!sharedSimulation) {
      return current;
    }

    const removedParticipantSessionIds = Array.from(
      new Set(sharedSimulation.removedParticipantSessionIds ?? []),
    );
    const nowIso = new Date().toISOString();

    switch (action) {
      case 'freeze':
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              collaborationState: 'frozen',
              allowStudentInteraction: false,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      case 'unfreeze':
      case 'open':
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              collaborationState: 'live',
              allowStudentInteraction: true,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      case 'close':
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              collaborationState: 'closed',
              allowStudentInteraction: false,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      case 'reset_session':
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              mirofishSessionId: undefined,
              collaborationState: 'inactive',
              spotlightSessionId: undefined,
              removedParticipantSessionIds: undefined,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      case 'spotlight':
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              spotlightSessionId: targetSessionId,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      case 'clear_spotlight':
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              spotlightSessionId: undefined,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      case 'remove_participant':
        if (targetSessionId && !removedParticipantSessionIds.includes(targetSessionId)) {
          removedParticipantSessionIds.push(targetSessionId);
        }
        return {
          ...current,
          stage: {
            ...current.stage,
            sharedSimulation: {
              ...sharedSimulation,
              removedParticipantSessionIds,
              spotlightSessionId:
                sharedSimulation.spotlightSessionId === targetSessionId
                  ? undefined
                  : sharedSimulation.spotlightSessionId,
              lastCollaborationSyncAt: nowIso,
            },
          },
        };
      default:
        return current;
    }
  });

  if (!updated?.stage.sharedSimulation) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'No MiroFish simulation is attached',
    );
  }

  const nextSnapshot = await getClassroomCollaborationSnapshot(id);
  if (!nextSnapshot) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'Classroom not found',
    );
  }

  await recordAuditEvent({
    organizationId: auth.session.organizationId,
    userId: auth.user.id,
    actorRole: auth.session.role,
    action: `classroom.mirofish.collaboration.${action}`,
    resourceType: 'classroom',
    resourceId: id,
    metadata: {
      classroomId: id,
      simulationId: updated.stage.sharedSimulation.simulationId,
      reportId: updated.stage.sharedSimulation.reportId ?? null,
      actorSessionId: auth.session.id,
      targetSessionId: targetSessionId ?? null,
    },
  });

  log.info('Collaboration updated', {
    classroomId: id,
    simulationId: updated.stage.sharedSimulation.simulationId,
    reportId: updated.stage.sharedSimulation.reportId ?? null,
    actorSessionId: auth.session.id,
    actorUserId: auth.user.id,
    targetSessionId: targetSessionId ?? null,
    result: action,
  });

  if (updated.roomVersion !== snapshot.classroom.roomVersion) {
    await recordClassroomRoomEvent({
      classroomId: id,
      roomVersion: updated.roomVersion,
      kind: 'collaboration.updated',
      actor: buildClassroomRoomEventActor({
        sessionId: access.auth.session.id,
        userId: access.auth.user.id,
        role: access.auth.session.role,
        kind: access.source,
      }),
      metadata: {
        action,
        targetSessionId: targetSessionId ?? null,
        simulationId: updated.stage.sharedSimulation.simulationId,
        reportId: updated.stage.sharedSimulation.reportId ?? null,
        collaborationState: updated.stage.sharedSimulation.collaborationState,
        spotlightSessionId: updated.stage.sharedSimulation.spotlightSessionId ?? null,
      },
    });
  }

  return apiSuccessWithRequestSession(request, {
    sharedSimulation: updated.stage.sharedSimulation,
    collaboration: buildClassroomCollaborationStatePayload(nextSnapshot, access.auth.session),
  });
}
