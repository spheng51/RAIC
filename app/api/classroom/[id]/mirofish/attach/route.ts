import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import { updateClassroom, readClassroom, isValidClassroomId } from '@/lib/server/classroom-storage';
import { recordAuditEvent } from '@/lib/server/audit-log';
import { createLogger } from '@/lib/logger';
import {
  buildMiroFishReportUrl,
  buildMiroFishRunUrl,
  isMiroFishMultiUserEnabled,
  validateMiroFishReport,
  validateMiroFishSimulation,
} from '@/lib/server/mirofish';
import type { SharedSimulation, SharedSimulationCollaborationMode } from '@/lib/types/stage';

interface AttachMiroFishBody {
  simulationId?: string;
  reportId?: string;
  defaultSurface?: 'lesson' | 'simulation';
  collaborationMode?: SharedSimulationCollaborationMode;
}

const log = createLogger('Classroom MiroFish Attach');

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiErrorWithRequestSession(request, API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  const classroom = await readClassroom(id);
  if (!classroom) {
    return apiErrorWithRequestSession(request, API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  const body = (await request.json()) as AttachMiroFishBody;
  const simulationId = body.simulationId?.trim();
  const reportId = body.reportId?.trim() || undefined;
  const defaultSurface = body.defaultSurface === 'simulation' ? 'simulation' : 'lesson';
  const requestedCollaborationMode =
    body.collaborationMode === 'multi-user' ? 'multi-user' : 'single-controller';

  if (!simulationId) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'simulationId is required',
    );
  }

  if (requestedCollaborationMode === 'multi-user' && !isMiroFishMultiUserEnabled()) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.INVALID_REQUEST,
      400,
      'MiroFish multi-user mode is not enabled for this deployment',
    );
  }

  try {
    await validateMiroFishSimulation(simulationId);
    if (reportId) {
      await validateMiroFishReport(reportId);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const status = message.includes('MIROFISH_') ? 500 : 400;
    log.warn('Attach rejected', {
      classroomId: id,
      simulationId,
      reportId: reportId ?? null,
      actorSessionId: auth.session.id,
      actorUserId: auth.user.id,
      result: 'validation_failed',
      status,
      error: message,
    });
    return apiErrorWithRequestSession(
      request,
      status === 500 ? API_ERROR_CODES.INTERNAL_ERROR : API_ERROR_CODES.INVALID_REQUEST,
      status,
      status === 500 ? 'MiroFish integration is not configured correctly' : message,
    );
  }

  const sharedSimulation: SharedSimulation = {
    provider: 'mirofish',
    simulationId,
    reportId,
    runUrl: buildMiroFishRunUrl(simulationId),
    reportUrl: reportId ? buildMiroFishReportUrl(reportId) : undefined,
    activeSurface: defaultSurface,
    controllerRole: 'teacher',
    collaborationMode: requestedCollaborationMode,
    collaborationState: 'inactive',
    allowStudentInteraction: requestedCollaborationMode === 'multi-user',
    participantCount: 0,
    lastCollaborationSyncAt: new Date().toISOString(),
    removedParticipantSessionIds: undefined,
    status: 'attached',
  };

  const updated = await updateClassroom(id, (current) => ({
    ...current,
    stage: {
      ...current.stage,
      sharedSimulation,
    },
  }));

  if (!updated) {
    return apiErrorWithRequestSession(request, API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  const hadExistingAttachment = Boolean(classroom.stage.sharedSimulation);

  await recordAuditEvent({
    organizationId: auth.session.organizationId,
    userId: auth.user.id,
    actorRole: auth.session.role,
    action: hadExistingAttachment ? 'classroom.mirofish.updated' : 'classroom.mirofish.attached',
    resourceType: 'classroom',
    resourceId: id,
    metadata: {
      simulationId,
      reportId,
      defaultSurface,
      collaborationMode: requestedCollaborationMode,
      classroomId: id,
      source: 'web',
      actorSessionId: auth.session.id,
    },
  });

  log.info('Attach succeeded', {
    classroomId: id,
    simulationId,
    reportId: reportId ?? null,
    actorSessionId: auth.session.id,
    actorUserId: auth.user.id,
    result: hadExistingAttachment ? 'updated' : 'attached',
  });

  return apiSuccessWithRequestSession(request, {
    sharedSimulation,
    attachedByUserId: auth.user.id,
  });
}
