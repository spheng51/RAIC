import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { apiError, apiSuccess, API_ERROR_CODES } from '@/lib/server/api-response';
import { updateClassroom, readClassroom, isValidClassroomId } from '@/lib/server/classroom-storage';
import {
  buildMiroFishReportUrl,
  buildMiroFishRunUrl,
  validateMiroFishReport,
  validateMiroFishSimulation,
} from '@/lib/server/mirofish';
import type { SharedSimulation } from '@/lib/types/stage';

interface AttachMiroFishBody {
  simulationId?: string;
  reportId?: string;
  defaultSurface?: 'lesson' | 'simulation';
}

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
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 400, 'Invalid classroom id');
  }

  const classroom = await readClassroom(id);
  if (!classroom) {
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  const body = (await request.json()) as AttachMiroFishBody;
  const simulationId = body.simulationId?.trim();
  const reportId = body.reportId?.trim() || undefined;
  const defaultSurface = body.defaultSurface === 'simulation' ? 'simulation' : 'lesson';

  if (!simulationId) {
    return apiError(
      API_ERROR_CODES.MISSING_REQUIRED_FIELD,
      400,
      'simulationId is required',
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
    return apiError(
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
    return apiError(API_ERROR_CODES.INVALID_REQUEST, 404, 'Classroom not found');
  }

  return apiSuccess({
    sharedSimulation,
    attachedByUserId: auth.user.id,
  });
}
