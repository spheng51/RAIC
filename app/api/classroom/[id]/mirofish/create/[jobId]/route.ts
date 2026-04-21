import { NextRequest, NextResponse } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import { requireClassroomAccess } from '@/lib/auth/classroom-access';
import { createLogger } from '@/lib/logger';
import { recordAuditEvent } from '@/lib/server/audit-log';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import { updateClassroom } from '@/lib/server/classroom-storage';
import {
  assertMiroFishAuthoringAvailable,
  buildMiroFishCreationFailureMessage,
  readMiroFishAuthoringJobStatus,
} from '@/lib/server/mirofish-authoring';
import {
  canAccessMiroFishCreationJob,
  isValidMiroFishCreationJobId,
  readMiroFishCreationJob,
  updateMiroFishCreationJob,
} from '@/lib/server/mirofish-authoring-job-store';
import {
  buildAttachedMiroFishSharedSimulation,
  validateMiroFishReport,
  validateMiroFishSimulation,
} from '@/lib/server/mirofish';

const log = createLogger('Classroom MiroFish Create Poll');

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string; jobId: string }> },
) {
  try {
    const auth = await requireRequestRole(request, ['teacher']);
    if (auth instanceof NextResponse) {
      return auth;
    }

    const { id, jobId } = await context.params;
    const access = await requireClassroomAccess(request, id);
    if (access instanceof NextResponse) {
      return access;
    }

    assertMiroFishAuthoringAvailable();

    if (!isValidMiroFishCreationJobId(jobId)) {
      return apiErrorWithRequestSession(request, 'INVALID_REQUEST', 400, 'Invalid MiroFish job id');
    }

    const job = await readMiroFishCreationJob(jobId);
    if (!job || job.classroomId !== id) {
      return apiErrorWithRequestSession(
        request,
        'INVALID_REQUEST',
        404,
        'MiroFish creation job not found',
      );
    }

    if (
      !canAccessMiroFishCreationJob(job, {
        organizationId: access.classroom.organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
      })
    ) {
      return apiErrorWithRequestSession(
        request,
        'FORBIDDEN',
        403,
        'You do not have access to this MiroFish creation job',
      );
    }

    if (job.sharedSimulation && job.status === 'ready') {
      return apiSuccessWithRequestSession(request, {
        status: job.status,
        sharedSimulation: job.sharedSimulation,
      });
    }

    if (job.status === 'failed') {
      return apiSuccessWithRequestSession(request, {
        status: job.status,
        error: job.error ?? 'MiroFish authoring failed',
      });
    }

    const authoring = await readMiroFishAuthoringJobStatus(job.externalJobId);

    if (authoring.status === 'queued' || authoring.status === 'running') {
      if (job.status !== authoring.status) {
        await updateMiroFishCreationJob(job.id, {
          status: authoring.status,
        });
      }

      return apiSuccessWithRequestSession(request, {
        status: authoring.status,
      });
    }

    if (authoring.status === 'failed') {
      const errorMessage = buildMiroFishCreationFailureMessage({
        result: authoring,
      });

      await updateMiroFishCreationJob(job.id, {
        status: 'failed',
        error: errorMessage,
        canRetry: true,
        completedAt: new Date().toISOString(),
      });

      await recordAuditEvent({
        organizationId: access.classroom.organizationId,
        userId: auth.user.id,
        actorRole: auth.session.role,
        action: 'classroom.mirofish.creation.failed',
        resourceType: 'classroom',
        resourceId: id,
        metadata: {
          classroomId: id,
          jobId: job.id,
          error: errorMessage,
        },
      });

      return apiSuccessWithRequestSession(request, {
        status: 'failed',
        error: errorMessage,
      });
    }

    if (!authoring.simulationId?.trim()) {
      throw new Error('MiroFish authoring completed without a simulationId');
    }

    await validateMiroFishSimulation(authoring.simulationId);
    if (authoring.reportId?.trim()) {
      await validateMiroFishReport(authoring.reportId);
    }

    const sharedSimulation = buildAttachedMiroFishSharedSimulation({
      simulationId: authoring.simulationId,
      reportId: authoring.reportId?.trim() || undefined,
      defaultSurface: job.spec.defaultSurface,
      collaborationMode: job.spec.collaborationMode,
      authoring: {
        source: 'ai-guided',
        briefPreview: job.briefPreview,
        createdAt: new Date().toISOString(),
      },
    });

    const updated = await updateClassroom(id, (current) => ({
      ...current,
      stage: {
        ...current.stage,
        sharedSimulation,
      },
    }));

    if (!updated) {
      return apiErrorWithRequestSession(request, 'INVALID_REQUEST', 404, 'Classroom not found');
    }

    await updateMiroFishCreationJob(job.id, {
      status: 'ready',
      canRetry: false,
      completedAt: new Date().toISOString(),
      sharedSimulation,
    });

    await recordAuditEvent({
      organizationId: access.classroom.organizationId,
      userId: auth.user.id,
      actorRole: auth.session.role,
      action: 'classroom.mirofish.creation.completed',
      resourceType: 'classroom',
      resourceId: id,
      metadata: {
        classroomId: id,
        jobId: job.id,
        simulationId: sharedSimulation.simulationId,
        reportId: sharedSimulation.reportId ?? null,
      },
    });

    return apiSuccessWithRequestSession(request, {
      status: 'ready',
      sharedSimulation,
    });
  } catch (error) {
    log.error('Failed to poll MiroFish creation job:', error);
    const message = error instanceof Error ? error.message : String(error);
    const status =
      (error instanceof Error && error.name === 'ZodError') ||
      message.includes('disabled') ||
      message.includes('required') ||
      message.includes('not enabled')
        ? 400
        : 500;
    return apiErrorWithRequestSession(
      request,
      status === 400 ? 'INVALID_REQUEST' : 'INTERNAL_ERROR',
      status,
      message,
    );
  }
}
