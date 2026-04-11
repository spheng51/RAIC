import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  canSessionControlPresentation,
  getClassroomPresentationSnapshot,
} from '@/lib/server/classroom-presentation';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { isValidClassroomId, updateClassroom } from '@/lib/server/classroom-storage';
import type { PresentationSurface, SharedSimulationStatus } from '@/lib/types/stage';

interface PresentationBody {
  activeSurface?: PresentationSurface;
  status?: SharedSimulationStatus;
}

const SURFACES: PresentationSurface[] = ['lesson', 'simulation', 'report'];
const STATUSES: SharedSimulationStatus[] = ['attached', 'running', 'completed', 'error'];

function isPresentationSurface(value: unknown): value is PresentationSurface {
  return typeof value === 'string' && SURFACES.includes(value as PresentationSurface);
}

function isSharedSimulationStatus(value: unknown): value is SharedSimulationStatus {
  return typeof value === 'string' && STATUSES.includes(value as SharedSimulationStatus);
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!isValidClassroomId(id)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
  }

  const access = await requireClassroomAccess(request, id);
  if (access instanceof NextResponse) {
    return access;
  }

  const snapshot = await getClassroomPresentationSnapshot(id);
  if (!snapshot) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  if (!snapshot.sharedSimulation) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'No MiroFish simulation is attached');
  }

  if (!canSessionControlPresentation(snapshot.sharedSimulation, access.auth.session)) {
    return apiError(
      API_ERROR_CODES.INVALID_REQUEST,
      403,
      'Only the teacher or the active controller can change the presentation',
    );
  }

  const body = (await request.json()) as PresentationBody;
  const nextSurface = body.activeSurface ?? snapshot.sharedSimulation.activeSurface;
  const nextStatus = body.status ?? snapshot.sharedSimulation.status;

  if (!isPresentationSurface(nextSurface)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid activeSurface value');
  }

  if (!isSharedSimulationStatus(nextStatus)) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid status value');
  }

  if (nextSurface === 'report' && !snapshot.reportAvailable) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'No report is attached to this classroom');
  }

  const updated = await updateClassroom(id, (current) => {
    if (!current.stage.sharedSimulation) {
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

  if (!updated?.stage.sharedSimulation) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'No MiroFish simulation is attached');
  }

  return apiSuccess({
    sharedSimulation: updated.stage.sharedSimulation,
  });
}
