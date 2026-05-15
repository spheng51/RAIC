import 'server-only';

import { runPostgresQuery } from '@/lib/db/client';
import type { PlatformRole } from '@/lib/db/schema';
import type {
  ClassroomGenerationJob,
  ClassroomGenerationJobOwner,
  ClassroomGenerationJobStatus,
} from '@/lib/server/classroom-job-store';
import type {
  GenerationCompletionStatus,
  GenerationWarning,
  SceneOutcome,
} from '@/lib/types/generation';
import type { ScheduledClassEvent } from '@/lib/types/scheduled-classes';

interface ClassroomGenerationJobRow {
  id: string;
  request_key: string | null;
  status: string;
  step: string;
  progress: number | string;
  message: string;
  owner_organization_id: string | null;
  owner_user_id: string | null;
  owner_actor_role: string | null;
  input_summary: ClassroomGenerationJob['inputSummary'] | string;
  scenes_generated: number | string;
  scenes_failed: number | string | null;
  total_scenes: number | string | null;
  completion_status: string | null;
  warnings: GenerationWarning[] | string | null;
  scene_outcomes: SceneOutcome[] | string | null;
  scheduled_class_event: ScheduledClassEvent | string | null;
  scheduled_class_error: string | null;
  result: ClassroomGenerationJob['result'] | string | null;
  error: string | null;
  attempt: number | string | null;
  max_attempts: number | string | null;
  can_retry: boolean | null;
  started_at: string | Date | null;
  completed_at: string | Date | null;
  created_at: string | Date;
  updated_at: string | Date;
}

const CLASSROOM_GENERATION_JOB_COLUMNS = `
  id,
  request_key,
  status,
  step,
  progress,
  message,
  owner_organization_id,
  owner_user_id,
  owner_actor_role,
  input_summary,
  scenes_generated,
  scenes_failed,
  total_scenes,
  completion_status,
  warnings,
  scene_outcomes,
  scheduled_class_event,
  scheduled_class_error,
  result,
  error,
  attempt,
  max_attempts,
  can_retry,
  started_at,
  completed_at,
  created_at,
  updated_at
`;

function parseJsonValue<T>(value: T | string | null | undefined, fallback: T): T {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function parseOptionalJsonValue<T>(value: T | string | null | undefined): T | undefined {
  if (value === null || value === undefined) return undefined;
  return typeof value === 'string' ? (JSON.parse(value) as T) : value;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

function toOptionalIso(value: string | Date | null): string | undefined {
  if (!value) return undefined;
  return toIso(value);
}

function toOptionalNumber(value: number | string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toNumber(value: number | string, fallback = 0): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function mapClassroomGenerationJobRow(row: ClassroomGenerationJobRow): ClassroomGenerationJob {
  const scheduledClassEvent = parseOptionalJsonValue<ScheduledClassEvent>(
    row.scheduled_class_event,
  );
  const result = parseOptionalJsonValue<ClassroomGenerationJob['result']>(row.result);
  const startedAt = toOptionalIso(row.started_at);
  const completedAt = toOptionalIso(row.completed_at);
  const scenesFailed = toOptionalNumber(row.scenes_failed);
  const totalScenes = toOptionalNumber(row.total_scenes);
  const attempt = toOptionalNumber(row.attempt);
  const maxAttempts = toOptionalNumber(row.max_attempts);

  return {
    id: row.id,
    ...(row.request_key ? { requestKey: row.request_key } : {}),
    status: row.status as ClassroomGenerationJobStatus,
    step: row.step as ClassroomGenerationJob['step'],
    progress: toNumber(row.progress),
    message: row.message,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
    owner: {
      organizationId: row.owner_organization_id,
      userId: row.owner_user_id,
      actorRole: row.owner_actor_role as PlatformRole | null,
    },
    ...(startedAt ? { startedAt } : {}),
    ...(completedAt ? { completedAt } : {}),
    ...(attempt !== undefined ? { attempt } : {}),
    ...(maxAttempts !== undefined ? { maxAttempts } : {}),
    ...(row.can_retry !== null ? { canRetry: row.can_retry } : {}),
    inputSummary: parseJsonValue<ClassroomGenerationJob['inputSummary']>(row.input_summary, {
      requirementPreview: '',
      language: 'zh-CN',
      hasPdf: false,
      pdfTextLength: 0,
      pdfImageCount: 0,
    }),
    scenesGenerated: toNumber(row.scenes_generated),
    ...(scenesFailed !== undefined ? { scenesFailed } : {}),
    ...(totalScenes !== undefined ? { totalScenes } : {}),
    ...(row.completion_status
      ? { completionStatus: row.completion_status as GenerationCompletionStatus }
      : {}),
    warnings: parseJsonValue<GenerationWarning[]>(row.warnings, []),
    sceneOutcomes: parseJsonValue<SceneOutcome[]>(row.scene_outcomes, []),
    ...(scheduledClassEvent ? { scheduledClassEvent } : {}),
    ...(row.scheduled_class_error ? { scheduledClassError: row.scheduled_class_error } : {}),
    ...(result ? { result } : {}),
    ...(row.error ? { error: row.error } : {}),
  };
}

function buildJobWriteParams(job: ClassroomGenerationJob): unknown[] {
  return [
    job.id,
    job.requestKey ?? null,
    job.status,
    job.step,
    job.progress,
    job.message,
    job.owner.organizationId,
    job.owner.userId,
    job.owner.actorRole,
    JSON.stringify(job.inputSummary),
    job.scenesGenerated,
    job.scenesFailed ?? null,
    job.totalScenes ?? null,
    job.completionStatus ?? null,
    JSON.stringify(job.warnings ?? []),
    JSON.stringify(job.sceneOutcomes ?? []),
    job.scheduledClassEvent ? JSON.stringify(job.scheduledClassEvent) : null,
    job.scheduledClassError ?? null,
    job.result ? JSON.stringify(job.result) : null,
    job.error ?? null,
    job.attempt ?? null,
    job.maxAttempts ?? null,
    job.canRetry ?? null,
    job.startedAt ?? null,
    job.completedAt ?? null,
    job.createdAt,
    job.updatedAt,
  ];
}

export async function insertClassroomGenerationJobRecord(
  job: ClassroomGenerationJob,
): Promise<ClassroomGenerationJob | null> {
  const rows = await runPostgresQuery<ClassroomGenerationJobRow>(
    `INSERT INTO classroom_generation_jobs (
        id,
        request_key,
        status,
        step,
        progress,
        message,
        owner_organization_id,
        owner_user_id,
        owner_actor_role,
        input_summary,
        scenes_generated,
        scenes_failed,
        total_scenes,
        completion_status,
        warnings,
        scene_outcomes,
        scheduled_class_event,
        scheduled_class_error,
        result,
        error,
        attempt,
        max_attempts,
        can_retry,
        started_at,
        completed_at,
        created_at,
        updated_at
      )
      VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, $13, $14,
        $15::jsonb, $16::jsonb, $17::jsonb, $18, $19::jsonb, $20, $21, $22,
        $23, $24, $25, $26, $27
      )
      ON CONFLICT DO NOTHING
      RETURNING ${CLASSROOM_GENERATION_JOB_COLUMNS}`,
    buildJobWriteParams(job),
  );

  return rows?.[0] ? mapClassroomGenerationJobRow(rows[0]) : null;
}

export async function readClassroomGenerationJobRecord(
  jobId: string,
): Promise<ClassroomGenerationJob | null> {
  const rows = await runPostgresQuery<ClassroomGenerationJobRow>(
    `SELECT ${CLASSROOM_GENERATION_JOB_COLUMNS}
     FROM classroom_generation_jobs
     WHERE id = $1
     LIMIT 1`,
    [jobId],
  );

  return rows?.[0] ? mapClassroomGenerationJobRow(rows[0]) : null;
}

export async function findClassroomGenerationJobRecordByRequestKey(
  requestKey: string,
  owner: ClassroomGenerationJobOwner,
): Promise<ClassroomGenerationJob | null> {
  const rows = await runPostgresQuery<ClassroomGenerationJobRow>(
    `SELECT ${CLASSROOM_GENERATION_JOB_COLUMNS}
     FROM classroom_generation_jobs
     WHERE request_key = $1
       AND owner_organization_id IS NOT DISTINCT FROM $2
       AND owner_user_id IS NOT DISTINCT FROM $3
       AND owner_actor_role IS NOT DISTINCT FROM $4
       AND status <> 'failed'
     ORDER BY updated_at DESC
     LIMIT 1`,
    [requestKey, owner.organizationId, owner.userId, owner.actorRole],
  );

  return rows?.[0] ? mapClassroomGenerationJobRow(rows[0]) : null;
}

export async function updateClassroomGenerationJobRecord(
  job: ClassroomGenerationJob,
): Promise<ClassroomGenerationJob | null> {
  const params = buildJobWriteParams(job);
  const rows = await runPostgresQuery<ClassroomGenerationJobRow>(
    `UPDATE classroom_generation_jobs
     SET request_key = $2,
         status = $3,
         step = $4,
         progress = $5,
         message = $6,
         owner_organization_id = $7,
         owner_user_id = $8,
         owner_actor_role = $9,
         input_summary = $10::jsonb,
         scenes_generated = $11,
         scenes_failed = $12,
         total_scenes = $13,
         completion_status = $14,
         warnings = $15::jsonb,
         scene_outcomes = $16::jsonb,
         scheduled_class_event = $17::jsonb,
         scheduled_class_error = $18,
         result = $19::jsonb,
         error = $20,
         attempt = $21,
         max_attempts = $22,
         can_retry = $23,
         started_at = $24,
         completed_at = $25,
         created_at = $26,
         updated_at = $27
     WHERE id = $1
     RETURNING ${CLASSROOM_GENERATION_JOB_COLUMNS}`,
    params,
  );

  return rows?.[0] ? mapClassroomGenerationJobRow(rows[0]) : null;
}
