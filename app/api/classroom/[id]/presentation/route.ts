import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  canSessionControlPresentation,
  getClassroomPresentationSnapshot,
} from '@/lib/server/classroom-presentation';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';
import { recordAuditEvent } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';
import type { PresentationSurface, SharedSimulationStatus } from '@/lib/types/stage';

interface PresentationBody {
  activeSurface?: PresentationSurface;
  status?: SharedSimulationStatus;
}

const SURFACES: PresentationSurface[] = ['lesson', 'simulation', 'report'];
const STATUSES: SharedSimulationStatus[] = ['attached', 'running', 'completed', 'error'];
const log = createLogger('Classroom Presentation');

function isPresentationSurface(value: unknown): value is PresentationSurface {
  return typeof value === 'string' && SURFACES.includes(value as PresentationSurface);
}

function isSharedSimulationStatus(value: unknown): value is SharedSimulationStatus {
  return typeof value === 'string' && STATUSES.includes(value as SharedSimulationStatus);
}

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  if (!canSessionControlPresentation(snapshot.sharedSimulation, access.auth.session)) {
    log.warn('Presentation update rejected', {
      classroomId: id,
      actorSessionId: access.auth.session.id,
      actorUserId: access.auth.user.id,
      actorKind: access.source,
      result: 'forbidden',
    });
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      403,
      'Only the teacher or the active controller can change the presentation',
    );
  }

  const body = (await request.json()) as PresentationBody;
  const nextSurface = body.activeSurface ?? snapshot.sharedSimulation.activeSurface;
  const nextStatus = body.status ?? snapshot.sharedSimulation.status;

  if (!isPresentationSurface(nextSurface)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid activeSurface value',
    );
  }

  if (!isSharedSimulationStatus(nextStatus)) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'Invalid status value',
    );
  }

  if (nextSurface === 'report' && !snapshot.reportAvailable) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'No report is attached to this classroom',
    );
  }

  let staleControlAttempt = false;
  const updated = await updateClassroom(id, (current) => {
    if (!current.stage.sharedSimulation) {
      return current;
    }

    if (!canSessionControlPresentation(current.stage.sharedSimulation, access.auth.session)) {
      staleControlAttempt = true;
      return current;
    }

    return {
      ...current,
      stage: {
        ...current.stage,
        sharedSimulation: {
          ...current.stage.sharedSimulation,
          activeSurface: nextSurface,
          status: nextStatus,
        },
      },
    };
  });

  if (staleControlAttempt) {
    log.warn('Presentation update dropped after controller changed', {
      classroomId: id,
      actorSessionId: access.auth.session.id,
      actorUserId: access.auth.user.id,
      actorKind: access.source,
      result: 'stale_control',
    });
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      409,
      'Presentation control changed before the update was applied',
    );
  }

  if (!updated?.stage.sharedSimulation) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      404,
      'No MiroFish simulation is attached',
    );
  }

  const previousSurface = snapshot.sharedSimulation.activeSurface;
  const previousStatus = snapshot.sharedSimulation.status;
  const auditAction =
    nextSurface !== previousSurface
      ? nextSurface === 'lesson' && nextStatus === 'error' && previousSurface !== 'lesson'
        ? 'classroom.presentation.recovered_to_lesson'
        : 'classroom.presentation.surface_changed'
      : null;

  if (auditAction) {
    await recordAuditEvent({
      organizationId: access.auth.session.organizationId,
      userId: access.auth.user.id,
      actorRole: access.auth.session.role,
      action: auditAction,
      resourceType: 'classroom',
      resourceId: id,
      metadata: {
        activeSurface: nextSurface,
        previousSurface,
        status: nextStatus,
        previousStatus,
        source: 'classroom',
        actorKind: access.source,
        actorSessionId: access.auth.session.id,
      },
    });
  }

  log.info('Presentation updated', {
    classroomId: id,
    simulationId: updated.stage.sharedSimulation.simulationId,
    reportId: updated.stage.sharedSimulation.reportId ?? null,
    actorSessionId: access.auth.session.id,
    actorUserId: access.auth.user.id,
    actorKind: access.source,
    activeSurface: nextSurface,
    previousSurface,
    status: nextStatus,
    previousStatus,
    result:
      nextSurface === 'lesson' && nextStatus === 'error' && previousSurface !== 'lesson'
        ? 'recovered_to_lesson'
        : nextSurface !== previousSurface
          ? 'surface_changed'
          : 'status_updated',
  });

  return apiSuccessWithRequestSession(request, {
    sharedSimulation: updated.stage.sharedSimulation,
  });
}
