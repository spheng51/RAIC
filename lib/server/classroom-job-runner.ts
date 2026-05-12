import { createLogger } from '@/lib/logger';
import type { PlatformRole } from '@/lib/db/schema';
import { generateClassroom, type GenerateClassroomInput } from '@/lib/server/classroom-generation';
import {
  markClassroomGenerationJobFailed,
  markClassroomGenerationJobRunning,
  markClassroomGenerationJobSucceeded,
  updateClassroomGenerationJobProgress,
} from '@/lib/server/classroom-job-store';
import { createScheduledClassForAccess } from '@/lib/server/scheduled-classes';
import type { ScheduledClassEvent } from '@/lib/types/scheduled-classes';

const log = createLogger('ClassroomJob');
const runningJobs = new Map<string, Promise<void>>();

export function runClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  baseUrl: string,
  scope: {
    organizationId: string | null;
    userId: string | null;
    actorRole?: PlatformRole | null;
  },
): Promise<void> {
  const existing = runningJobs.get(jobId);
  if (existing) {
    return existing;
  }

  const jobPromise = (async () => {
    try {
      await markClassroomGenerationJobRunning(jobId);

      const result = await generateClassroom(input, {
        baseUrl,
        organizationId: scope.organizationId,
        userId: scope.userId,
        onProgress: async (progress) => {
          await updateClassroomGenerationJobProgress(jobId, progress);
        },
      });

      let scheduledClassEvent: ScheduledClassEvent | undefined;
      let scheduledClassError: string | undefined;
      if (input.scheduledClass) {
        try {
          if (!scope.userId) {
            throw new Error('Cannot create a scheduled class without a teacher user.');
          }

          scheduledClassEvent = await createScheduledClassForAccess(
            {
              role: scope.actorRole ?? 'teacher',
              userId: scope.userId,
              organizationId: scope.organizationId,
            },
            {
              ...input.scheduledClass,
              classroomId: result.id,
            },
            { requireFutureStart: false },
          );
        } catch (scheduleError) {
          scheduledClassError =
            scheduleError instanceof Error ? scheduleError.message : String(scheduleError);
          log.warn(`Classroom generation job ${jobId} schedule link failed:`, scheduleError);
        }
      }

      await markClassroomGenerationJobSucceeded(jobId, result, {
        ...(scheduledClassEvent ? { scheduledClassEvent } : {}),
        ...(scheduledClassError ? { scheduledClassError } : {}),
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log.error(`Classroom generation job ${jobId} failed:`, error);
      try {
        await markClassroomGenerationJobFailed(jobId, message);
      } catch (markFailedError) {
        log.error(`Failed to persist failed status for job ${jobId}:`, markFailedError);
      }
    } finally {
      runningJobs.delete(jobId);
    }
  })();

  runningJobs.set(jobId, jobPromise);
  return jobPromise;
}
