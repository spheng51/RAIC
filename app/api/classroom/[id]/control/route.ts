import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  getClassroomPresentationSnapshot,
  resetSharedSimulationControl,
} from '@/lib/server/classroom-presentation';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';

interface ControlBody {
  action?: 'grant' | 'revoke';
  targetSessionId?: string;
  leaseMinutes?: number;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireRequestRole(request, ['teacher']);
  if (auth instanceof NextResponse) {
    return auth;
  }

  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
  }

  const snapshot = await getClassroomPresentationSnapshot(id);
  if (!snapshot) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  if (!snapshot.sharedSimulation) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'No MiroFish simulation is attached');
  }

  const body = (await request.json()) as ControlBody;
  if (body.action !== 'grant' && body.action !== 'revoke') {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid action');
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

    const targetSessionId = body.targetSessionId?.trim();
    const targetParticipant = snapshot.participants.find(
      (participant) => participant.sessionId === targetSessionId,
    );
    if (!targetSessionId || !targetParticipant) {
      return current;
    }

    const leaseMinutes = Math.min(Math.max(body.leaseMinutes ?? 10, 1), 120);
    return {
      ...current,
      stage: {
        ...current.stage,
        sharedSimulation: {
          ...sharedSimulation,
          controllerSessionId: targetSessionId,
          controllerRole: 'student',
          controlLeaseExpiresAt: new Date(Date.now() + leaseMinutes * 60 * 1000).toISOString(),
        },
      },
    };
  });

  const nextSharedSimulation = updated?.stage.sharedSimulation;
  if (!nextSharedSimulation) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'No MiroFish simulation is attached');
  }

  if (body.action === 'grant') {
    const targetSessionId = body.targetSessionId?.trim();
    const targetParticipant = snapshot.participants.find(
      (participant) => participant.sessionId === targetSessionId,
    );
    if (!targetSessionId || !targetParticipant) {
      return apiError(
        API_ERROR_CODES.INVALID_REQUEST,
        400,
        'targetSessionId must match an active classroom session',
      );
    }
  }

  return apiSuccess({
    sharedSimulation: nextSharedSimulation,
    updatedByUserId: auth.user.id,
  });
}
