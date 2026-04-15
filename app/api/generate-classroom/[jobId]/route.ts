import { type NextRequest } from 'next/server';
import { requireRequestRole } from '@/lib/auth/authorize';
import {
  apiErrorWithRequestSession,
  apiSuccessWithRequestSession,
} from '@/lib/server/api-response';
import {
  canAccessClassroomGenerationJob,
  isValidClassroomJobId,
  readClassroomGenerationJob,
} from '@/lib/server/classroom-job-store';
import { buildRequestOrigin } from '@/lib/server/classroom-storage';
import { createLogger } from '@/lib/logger';

const log = createLogger('ClassroomJob API');

export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, context: { params: Promise<{ jobId: string }> }) {
  let resolvedJobId: string | undefined;
  try {
    const auth = await requireRequestRole(req, ['teacher']);
    if ('status' in auth) {
      return auth;
    }

    const { jobId } = await context.params;
    resolvedJobId = jobId;

    if (!isValidClassroomJobId(jobId)) {
      return apiErrorWithRequestSession(
        req,
        'INVALID_REQUEST',
        400,
        'Invalid classroom generation job id',
      );
    }

    const job = await readClassroomGenerationJob(jobId);
    if (!job) {
      return apiErrorWithRequestSession(
        req,
        'INVALID_REQUEST',
        404,
        'Classroom generation job not found',
      );
    }

    if (!canAccessClassroomGenerationJob(job, auth)) {
      return apiErrorWithRequestSession(
        req,
        'FORBIDDEN',
        403,
        'You do not have access to this classroom generation job',
      );
    }

    const pollUrl = `${buildRequestOrigin(req)}/api/generate-classroom/${jobId}`;

    return apiSuccessWithRequestSession(req, {
      jobId: job.id,
      status: job.status,
      step: job.step,
      progress: job.progress,
      message: job.message,
      pollUrl,
      pollIntervalMs: 5000,
      scenesGenerated: job.scenesGenerated,
      totalScenes: job.totalScenes,
      result: job.result
        ? {
            id: job.result.classroomId,
            url: job.result.url,
            scenesCount: job.result.scenesCount,
          }
        : null,
      error: job.error,
      done: job.status === 'succeeded' || job.status === 'failed',
    });
  } catch (error) {
    log.error(`Classroom job retrieval failed [jobId=${resolvedJobId ?? 'unknown'}]:`, error);
    return apiErrorWithRequestSession(
      req,
      'INTERNAL_ERROR',
      500,
      'Failed to retrieve classroom generation job',
      error instanceof Error ? error.message : String(error),
    );
  }
}
