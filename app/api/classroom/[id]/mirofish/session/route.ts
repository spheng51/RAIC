import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { createLogger } from '@/lib/logger';
import {
  canSessionModerateCollaboration,
  getClassroomCollaborationSnapshot,
} from '@/lib/server/classroom-collaboration';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
  API_ERROR_CODES,
} from '@/lib/server/api-response';
import {
  isMiroFishMultiUserEnabled,
  issueMiroFishParticipantToken,
  type MiroFishParticipantCapability,
  withMiroFishParticipantToken,
} from '@/lib/server/mirofish';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';
import {
  getSharedSimulationCollaborationMode,
  getSharedSimulationRemovedSessionIds,
} from '@/lib/utils/classroom-presentation';

interface MiroFishSessionBody {
  forceNew?: boolean;
}

const log = createLogger('Classroom MiroFish Session');

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  const body = ((await request.json().catch(() => ({}))) ?? {}) as MiroFishSessionBody;
  const forceNew = body.forceNew === true;
  const viewerCanModerate = canSessionModerateCollaboration(access.auth.session);

  if (forceNew && !viewerCanModerate) {
    return apiErrorWithRequestSession(
      request,
      API_ERROR_CODES.FORBIDDEN,
      403,
      'Only the teacher can reset the shared MiroFish session',
    );
  }

  let sharedSimulation = snapshot.sharedSimulation;
  if (
    forceNew ||
    !sharedSimulation.mirofishSessionId ||
    sharedSimulation.collaborationState === 'inactive'
  ) {
    const nextSessionId = forceNew
      ? randomUUID()
      : (sharedSimulation.mirofishSessionId ?? randomUUID());
    const updated = await updateClassroom(id, (current) => {
      const currentSharedSimulation = current.stage.sharedSimulation;
      if (!currentSharedSimulation) {
        return current;
      }

      return {
        ...current,
        stage: {
          ...current.stage,
          sharedSimulation: {
            ...currentSharedSimulation,
            mirofishSessionId: nextSessionId,
            collaborationState:
              currentSharedSimulation.collaborationState === 'closed' ? 'closed' : 'live',
            participantCount: snapshot.participants.length,
            lastCollaborationSyncAt: new Date().toISOString(),
          },
        },
      };
    });

    if (!updated?.stage.sharedSimulation) {
      return apiErrorWithRequestSession(
        request,
        API_ERROR_CODES.INVALID_REQUEST,
        404,
        'No MiroFish simulation is attached',
      );
    }

    sharedSimulation = updated.stage.sharedSimulation;
  }

  const capabilities: MiroFishParticipantCapability[] = ['view'];
  const viewerIsRemoved = getSharedSimulationRemovedSessionIds(sharedSimulation).includes(
    access.auth.session.id,
  );
  const viewerCanInteract =
    !viewerIsRemoved &&
    sharedSimulation.collaborationState === 'live' &&
    sharedSimulation.allowStudentInteraction !== false;
  if (viewerCanModerate) {
    capabilities.push('interact', 'moderate');
  } else if (viewerCanInteract) {
    capabilities.push('interact');
  }

  const mirofishSessionId = sharedSimulation.mirofishSessionId ?? randomUUID();

  const participantToken = issueMiroFishParticipantToken({
    classroomId: id,
    simulationId: sharedSimulation.simulationId,
    reportId: sharedSimulation.reportId,
    mirofishSessionId,
    sessionId: access.auth.session.id,
    userId: access.auth.user.id,
    displayName: access.auth.user.displayName,
    role: access.auth.session.role === 'student' ? 'student' : 'teacher',
    capabilities,
  });
  const embedUrl = withMiroFishParticipantToken(sharedSimulation.runUrl, {
    mirofishSessionId,
    participantToken: participantToken?.token ?? null,
  });

  log.info('Issued collaboration embed session', {
    classroomId: id,
    simulationId: sharedSimulation.simulationId,
    reportId: sharedSimulation.reportId ?? null,
    actorSessionId: access.auth.session.id,
    actorUserId: access.auth.user.id,
    mirofishSessionId,
    capabilities,
    result: forceNew ? 'reset' : 'issued',
  });

  return apiSuccessWithRequestSession(request, {
    mirofishSessionId,
    collaborationMode: 'multi-user',
    embedUrl,
    tokenExpiresAt: participantToken?.expiresAt ?? null,
    capabilities,
  });
}
