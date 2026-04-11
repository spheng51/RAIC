import { NextRequest, NextResponse } from 'next/server';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import {
  canSessionControlPresentation,
  doesSessionOwnSimulationControl,
  getClassroomPresentationSnapshot,
} from '@/lib/server/classroom-presentation';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { isValidClassroomId } from '@/lib/server/classroom-storage';

export async function GET(
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

  const viewerCanManageSimulation =
    access.auth.session.kind === 'web' && access.auth.session.role !== 'student';
  const viewerCanControlPresentation = canSessionControlPresentation(
    snapshot.sharedSimulation,
    access.auth.session,
  );
  const viewerHasSimulationControl = doesSessionOwnSimulationControl(
    snapshot.sharedSimulation,
    access.auth.session,
  );

  return apiSuccess({
    activeSurface: snapshot.sharedSimulation?.activeSurface ?? 'lesson',
    controllerSessionId: snapshot.sharedSimulation?.controllerSessionId ?? null,
    controllerRole: snapshot.sharedSimulation?.controllerRole ?? 'teacher',
    controlLeaseExpiresAt: snapshot.sharedSimulation?.controlLeaseExpiresAt ?? null,
    simulationStatus: snapshot.sharedSimulation?.status ?? null,
    reportAvailable: snapshot.reportAvailable,
    sharedSimulation: snapshot.sharedSimulation
      ? {
          ...snapshot.sharedSimulation,
          runUrl: snapshot.runUrl ?? snapshot.sharedSimulation.runUrl,
          reportUrl: snapshot.reportUrl ?? snapshot.sharedSimulation.reportUrl,
        }
      : null,
    runUrl: snapshot.runUrl,
    reportUrl: snapshot.reportUrl,
    viewerSessionId: access.auth.session.id,
    viewerRole: access.auth.session.role,
    viewerKind: access.auth.session.kind,
    viewerCanManageSimulation,
    viewerCanControlPresentation,
    viewerHasSimulationControl,
    participants: snapshot.participants,
  });
}
