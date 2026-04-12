import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  getClassroomPresentationSnapshot,
  resetSharedSimulationControl,
} from '@/lib/server/classroom-presentation';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';
import { recordAuditEvent } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';
import { getSharedSimulationCollaborationMode } from '@/lib/utils/classroom-presentation';

interface ControlBody {
  action?: 'grant' | 'revoke';
  targetSessionId?: string;
  leaseMinutes?: number;
}

const log = createLogger('Classroom Presentation Control');

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

  const snapshot = await getClassroomPresentationSnapshot(id);
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

  if (getSharedSimulationCollaborationMode(snapshot.sharedSimulation) === 'multi-user') {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Single-controller leases are unavailable while MiroFish multi-user mode is active',
    );
  }

  const body = (await request.json()) as ControlBody;
  if (body.action !== 'grant' && body.action !== 'revoke') {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid action',
    );
  }

  const targetSessionId = body.targetSessionId?.trim();
  const requestedLeaseMinutes = Math.min(Math.max(body.leaseMinutes ?? 10, 1), 120);

  if (body.action === 'grant') {
    const targetParticipant = snapshot.participants.find(
      (participant) => participant.sessionId === targetSessionId,
    );
    if (!targetSessionId || !targetParticipant) {
      log.warn('Control update rejected', {
        classroomId: id,
        simulationId: snapshot.sharedSimulation.simulationId,
        reportId: snapshot.sharedSimulation.reportId ?? null,
        actorSessionId: auth.session.id,
        actorUserId: auth.user.id,
        targetSessionId: targetSessionId ?? null,
        leaseMinutes: requestedLeaseMinutes,
        result: 'invalid_target',
      });
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

    if (body.action === 'revoke') {
      return {
        ...current,
        stage: {
          ...current.stage,
          sharedSimulation: resetSharedSimulationControl(sharedSimulation),
        },
      };
    }

    return {
      ...current,
      stage: {
        ...current.stage,
        sharedSimulation: {
          ...sharedSimulation,
          controllerSessionId: targetSessionId,
          controllerRole: 'student',
          controlLeaseExpiresAt: new Date(
            Date.now() + requestedLeaseMinutes * 60 * 1000,
          ).toISOString(),
        },
      },
    };
  });

  const nextSharedSimulation = updated?.stage.sharedSimulation;
  if (!nextSharedSimulation) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'No MiroFish simulation is attached',
    );
  }

  await recordAuditEvent({
    organizationId: auth.session.organizationId,
    userId: auth.user.id,
    actorRole: auth.session.role,
    action:
      body.action === 'grant'
        ? 'classroom.presentation_control.granted'
        : 'classroom.presentation_control.revoked',
    resourceType: 'classroom',
    resourceId: id,
    metadata: {
      actorSessionId: auth.session.id,
      targetSessionId: targetSessionId ?? null,
      leaseMinutes: body.action === 'grant' ? requestedLeaseMinutes : null,
      nextControllerSessionId: nextSharedSimulation.controllerSessionId ?? null,
      controllerRole: nextSharedSimulation.controllerRole,
    },
  });

  log.info('Control updated', {
    classroomId: id,
    simulationId: nextSharedSimulation.simulationId,
    reportId: nextSharedSimulation.reportId ?? null,
    actorSessionId: auth.session.id,
    actorUserId: auth.user.id,
    targetSessionId: targetSessionId ?? null,
    leaseMinutes: body.action === 'grant' ? requestedLeaseMinutes : null,
    nextControllerSessionId: nextSharedSimulation.controllerSessionId ?? null,
    controllerRole: nextSharedSimulation.controllerRole,
    result: body.action === 'grant' ? 'granted' : 'revoked',
  });

  return apiSuccessWithRequestSession(request, {
    sharedSimulation: nextSharedSimulation,
    updatedByUserId: auth.user.id,
  });
}
