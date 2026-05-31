import { promises as fs } from 'fs';
import { createHash } from 'crypto';
import path from 'path';
import type { AuthContext } from '@/lib/auth/current-user';
import { isPostgresConfigured } from '@/lib/db/client';
import {
  findClassroomGenerationJobRecordByRequestKey,
  insertClassroomGenerationJobRecord,
  readClassroomGenerationJobRecord,
  updateClassroomGenerationJobRecord,
} from '@/lib/db/repositories/classroom-generation-jobs';
import type { PlatformRole } from '@/lib/db/schema';
import type {
  ClassroomGenerationProgress,
  ClassroomGenerationStep,
  GenerateClassroomInput,
  GenerateClassroomResult,
} from '@/lib/server/classroom-generation';
import type {
  GenerationCompletionStatus,
  GenerationWarning,
  SceneOutcome,
} from '@/lib/types/generation';
import type { ScheduledClassEvent } from '@/lib/types/scheduled-classes';
import {
  CLASSROOM_JOBS_DIR,
  ensureClassroomJobsDir,
  writeJsonFileAtomic,
} from '@/lib/server/classroom-storage';

export type ClassroomGenerationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export interface ClassroomGenerationJobOwner {
  organizationId: string | null;
  userId: string | null;
  actorRole: PlatformRole | null;
}

export interface ClassroomGenerationJob {
  id: string;
  requestKey?: string;
  status: ClassroomGenerationJobStatus;
  step: ClassroomGenerationStep | 'queued' | 'failed';
  progress: number;
  message: string;
  createdAt: string;
  updatedAt: string;
  owner: ClassroomGenerationJobOwner;
  startedAt?: string;
  completedAt?: string;
  attempt?: number;
  maxAttempts?: number;
  canRetry?: boolean;
  inputSummary: {
    requirementPreview: string;
    language: string;
    hasPdf: boolean;
    pdfTextLength: number;
    pdfImageCount: number;
  };
  scenesGenerated: number;
  scenesFailed?: number;
  totalScenes?: number;
  completionStatus?: GenerationCompletionStatus;
  warnings?: GenerationWarning[];
  sceneOutcomes?: SceneOutcome[];
  scheduledClassEvent?: ScheduledClassEvent;
  scheduledClassError?: string;
  result?: {
    classroomId: string;
    url: string;
    scenesCount: number;
    totalScenes: number;
    completionStatus: Exclude<GenerationCompletionStatus, 'failed'>;
    warnings: GenerationWarning[];
    sceneOutcomes: SceneOutcome[];
  };
  error?: string;
}

export interface ClassroomGenerationJobSuccessMetadata {
  scheduledClassEvent?: ScheduledClassEvent;
  scheduledClassError?: string;
}

interface ReadClassroomGenerationJobOptions {
  applyStaleTimeout?: boolean;
}

function jobFilePath(jobId: string) {
  return path.join(CLASSROOM_JOBS_DIR, `${jobId}.json`);
}

function buildInputSummary(input: GenerateClassroomInput): ClassroomGenerationJob['inputSummary'] {
  return {
    requirementPreview:
      input.requirement.length > 200 ? `${input.requirement.slice(0, 197)}...` : input.requirement,
    language: input.language || 'zh-CN',
    hasPdf: !!input.pdfContent,
    pdfTextLength: input.pdfContent?.text.length || 0,
    pdfImageCount: input.pdfContent?.images.length || 0,
  };
}

function buildClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  owner: ClassroomGenerationJobOwner,
  requestKey?: string,
): ClassroomGenerationJob {
  const now = new Date().toISOString();
  return {
    id: jobId,
    ...(requestKey ? { requestKey } : {}),
    status: 'queued',
    step: 'queued',
    progress: 0,
    message: 'Classroom generation job queued',
    createdAt: now,
    updatedAt: now,
    owner,
    attempt: 1,
    maxAttempts: 1,
    canRetry: false,
    inputSummary: buildInputSummary(input),
    scenesGenerated: 0,
  };
}

/** Simple per-job mutex to serialize read-modify-write on the same job file. */
const jobLocks = new Map<string, Promise<void>>();

async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const prev = jobLocks.get(jobId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  jobLocks.set(jobId, next);
  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
    if (jobLocks.get(jobId) === next) jobLocks.delete(jobId);
  }
}

function buildRequestKeyLockId(requestKey: string, owner: ClassroomGenerationJobOwner): string {
  return [
    owner.organizationId ?? 'no-org',
    owner.userId ?? 'no-user',
    owner.actorRole ?? 'no-role',
    requestKey,
  ].join('::');
}

const requestKeyLocks = new Map<string, Promise<void>>();

async function withRequestKeyLock<T>(
  requestKey: string,
  owner: ClassroomGenerationJobOwner,
  fn: () => Promise<T>,
): Promise<T> {
  const lockId = buildRequestKeyLockId(requestKey, owner);
  const prev = requestKeyLocks.get(lockId) ?? Promise.resolve();
  let resolve: () => void;
  const next = new Promise<void>((r) => {
    resolve = r;
  });
  requestKeyLocks.set(lockId, next);
  try {
    await prev;
    return await fn();
  } finally {
    resolve!();
    if (requestKeyLocks.get(lockId) === next) requestKeyLocks.delete(lockId);
  }
}

const REQUEST_KEY_CLAIM_STALE_MS = 90_000;
const REQUEST_KEY_CLAIM_POLL_MS = 25;

interface ClassroomGenerationJobRequestKeyClaim {
  requestKey: string;
  jobId: string;
  createdAt: string;
  lockId: string;
}

function requestKeyClaimFileName(requestKey: string, owner: ClassroomGenerationJobOwner) {
  const lockId = buildRequestKeyLockId(requestKey, owner);
  const hash = createHash('sha256').update(lockId).digest('hex');
  return `.request-key-${hash}.json`;
}

function requestKeyClaimPath(requestKey: string, owner: ClassroomGenerationJobOwner) {
  return path.join(CLASSROOM_JOBS_DIR, requestKeyClaimFileName(requestKey, owner));
}

function isRequestKeyClaimStale(claim: ClassroomGenerationJobRequestKeyClaim): boolean {
  return Date.now() - new Date(claim.createdAt).getTime() > REQUEST_KEY_CLAIM_STALE_MS;
}

async function readRequestKeyClaim(
  claimPath: string,
): Promise<ClassroomGenerationJobRequestKeyClaim | null> {
  try {
    const content = await fs.readFile(claimPath, 'utf-8');
    const parsed = JSON.parse(content) as ClassroomGenerationJobRequestKeyClaim;
    if (
      typeof parsed.requestKey !== 'string' ||
      typeof parsed.jobId !== 'string' ||
      typeof parsed.createdAt !== 'string' ||
      typeof parsed.lockId !== 'string'
    ) {
      return null;
    }
    return parsed;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    return null;
  }
}

async function writeRequestKeyClaim(
  claimPath: string,
  claim: ClassroomGenerationJobRequestKeyClaim,
): Promise<boolean> {
  try {
    await fs.writeFile(claimPath, JSON.stringify(claim, null, 2), {
      encoding: 'utf-8',
      flag: 'wx',
    });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      return false;
    }
    throw error;
  }
}

async function removeRequestKeyClaim(claimPath: string): Promise<void> {
  await fs.rm(claimPath, { force: true });
}

async function readUsableRequestKeyClaimedJob(
  requestKey: string,
  owner: ClassroomGenerationJobOwner,
  claimPath: string,
): Promise<ClassroomGenerationJob | null> {
  const claim = await readRequestKeyClaim(claimPath);
  if (!claim || claim.requestKey !== requestKey) {
    await removeRequestKeyClaim(claimPath);
    return null;
  }

  const claimedJob = await readClassroomGenerationJobFile(claim.jobId, {
    applyStaleTimeout: false,
  }).catch(() => null);
  if (!claimedJob) {
    if (isRequestKeyClaimStale(claim)) {
      await removeRequestKeyClaim(claimPath);
    }
    return null;
  }

  if (!classroomGenerationJobOwnerMatches(claimedJob, owner)) {
    await removeRequestKeyClaim(claimPath);
    return null;
  }

  if (claimedJob.status === 'failed') {
    await removeRequestKeyClaim(claimPath);
    return null;
  }

  const reusableJob = await normalizeReusableRequestKeyJob(claimedJob);
  if (!reusableJob) {
    await removeRequestKeyClaim(claimPath);
    return null;
  }

  return reusableJob;
}

async function waitForUsableRequestKeyClaim(
  requestKey: string,
  owner: ClassroomGenerationJobOwner,
  claimPath: string,
): Promise<ClassroomGenerationJob | null> {
  while (true) {
    const claimedJob = await readUsableRequestKeyClaimedJob(requestKey, owner, claimPath);
    if (claimedJob) {
      return claimedJob;
    }

    const claim = await readRequestKeyClaim(claimPath);
    if (!claim) {
      return null;
    }

    if (isRequestKeyClaimStale(claim)) {
      return null;
    }

    await new Promise((resolve) => setTimeout(resolve, REQUEST_KEY_CLAIM_POLL_MS));
  }
}

async function findReusableJobFromRequestKeyClaim(
  requestKey: string,
  owner: ClassroomGenerationJobOwner,
): Promise<ClassroomGenerationJob | null> {
  const claimPath = requestKeyClaimPath(requestKey, owner);
  await ensureClassroomJobsDir();
  const claim = await readRequestKeyClaim(claimPath);
  if (!claim) {
    return null;
  }

  const claimedJob = await readUsableRequestKeyClaimedJob(requestKey, owner, claimPath);
  if (!claimedJob && isRequestKeyClaimStale(claim)) {
    await removeRequestKeyClaim(claimPath);
  }

  return claimedJob;
}

/** Max age (ms) before a "running" job without an active runner is considered stale. */
const STALE_JOB_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

function markStaleIfNeeded(job: ClassroomGenerationJob): ClassroomGenerationJob {
  if (job.status !== 'running') return job;
  const updatedAt = new Date(job.updatedAt).getTime();
  if (Date.now() - updatedAt > STALE_JOB_TIMEOUT_MS) {
    return {
      ...job,
      status: 'failed',
      step: 'failed',
      message: 'Job appears stale (no progress update for 30 minutes)',
      completionStatus: 'failed',
      canRetry: true,
      error: 'Stale job: process may have restarted during generation',
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }
  return job;
}

async function persistStaleRequestKeyJobIfNeeded(
  job: ClassroomGenerationJob,
): Promise<ClassroomGenerationJob> {
  const markedJob = markStaleIfNeeded(job);
  if (markedJob === job) {
    return job;
  }

  if (isPostgresConfigured()) {
    return (await updateClassroomGenerationJobRecord(markedJob)) ?? markedJob;
  }

  await writeJsonFileAtomic(jobFilePath(markedJob.id), markedJob);
  return markedJob;
}

async function normalizeReusableRequestKeyJob(
  job: ClassroomGenerationJob,
): Promise<ClassroomGenerationJob | null> {
  const markedJob = await persistStaleRequestKeyJobIfNeeded(job);
  return markedJob.status === 'failed' ? null : markedJob;
}

export function isValidClassroomJobId(jobId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(jobId);
}

export async function createClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  owner: ClassroomGenerationJobOwner,
  requestKey?: string,
): Promise<ClassroomGenerationJob> {
  const job = buildClassroomGenerationJob(jobId, input, owner, requestKey);

  if (isPostgresConfigured()) {
    const inserted = await insertClassroomGenerationJobRecord(job);
    if (inserted) {
      return inserted;
    }

    if (requestKey) {
      const existing = await findClassroomGenerationJobByRequestKey(requestKey, owner);
      if (existing) {
        return existing;
      }

      const retryInserted = await insertClassroomGenerationJobRecord(job);
      if (retryInserted) {
        return retryInserted;
      }
    }

    throw new Error(`Classroom generation job insert conflicted: ${jobId}`);
  }

  await ensureClassroomJobsDir();
  await writeJsonFileAtomic(jobFilePath(jobId), job);
  return job;
}

export async function createOrReuseClassroomGenerationJob(
  jobId: string,
  input: GenerateClassroomInput,
  owner: ClassroomGenerationJobOwner,
  requestKey?: string,
): Promise<{ existing: boolean; job: ClassroomGenerationJob }> {
  if (isPostgresConfigured()) {
    if (!requestKey) {
      return {
        existing: false,
        job: await createClassroomGenerationJob(jobId, input, owner),
      };
    }

    const existingJob = await findClassroomGenerationJobByRequestKey(requestKey, owner);
    if (existingJob) {
      return { existing: true, job: existingJob };
    }

    const inserted = await insertClassroomGenerationJobRecord(
      buildClassroomGenerationJob(jobId, input, owner, requestKey),
    );
    if (inserted) {
      return { existing: false, job: inserted };
    }

    const conflictingJob = await findClassroomGenerationJobByRequestKey(requestKey, owner);
    if (conflictingJob) {
      return { existing: true, job: conflictingJob };
    }

    throw new Error(
      `Classroom generation job request-key conflict could not be resolved: ${jobId}`,
    );
  }

  if (!requestKey) {
    return {
      existing: false,
      job: await createClassroomGenerationJob(jobId, input, owner),
    };
  }

  return withRequestKeyLock(requestKey, owner, async () => {
    const claimPath = requestKeyClaimPath(requestKey, owner);
    await ensureClassroomJobsDir();

    while (true) {
      const existingJob = await findClassroomGenerationJobByRequestKey(requestKey, owner);
      if (existingJob) {
        return { existing: true, job: existingJob };
      }

      const claimedJob = await waitForUsableRequestKeyClaim(requestKey, owner, claimPath);
      if (claimedJob) {
        return { existing: true, job: claimedJob };
      }

      const claim: ClassroomGenerationJobRequestKeyClaim = {
        requestKey,
        jobId,
        createdAt: new Date().toISOString(),
        lockId: buildRequestKeyLockId(requestKey, owner),
      };

      const acquired = await writeRequestKeyClaim(claimPath, claim);
      if (!acquired) {
        continue;
      }

      try {
        const retryExistingJob = await findClassroomGenerationJobByRequestKey(requestKey, owner);
        if (retryExistingJob) {
          await removeRequestKeyClaim(claimPath);
          return { existing: true, job: retryExistingJob };
        }

        return {
          existing: false,
          job: await createClassroomGenerationJob(jobId, input, owner, requestKey),
        };
      } catch (error) {
        await removeRequestKeyClaim(claimPath);
        throw error;
      }
    }
  });
}

function classroomGenerationJobOwnerMatches(
  job: ClassroomGenerationJob,
  owner: ClassroomGenerationJobOwner,
): boolean {
  return (
    job.owner.organizationId === owner.organizationId &&
    job.owner.userId === owner.userId &&
    job.owner.actorRole === owner.actorRole
  );
}

export async function readClassroomGenerationJob(
  jobId: string,
): Promise<ClassroomGenerationJob | null> {
  if (isPostgresConfigured()) {
    const job = await readClassroomGenerationJobRecord(jobId);
    return job ? markStaleIfNeeded(job) : null;
  }

  return readClassroomGenerationJobFile(jobId);
}

async function readClassroomGenerationJobFile(
  jobId: string,
  options: ReadClassroomGenerationJobOptions = {},
): Promise<ClassroomGenerationJob | null> {
  try {
    const content = await fs.readFile(jobFilePath(jobId), 'utf-8');
    const job = JSON.parse(content) as ClassroomGenerationJob;
    return options.applyStaleTimeout === false ? job : markStaleIfNeeded(job);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function findClassroomGenerationJobByRequestKey(
  requestKey: string,
  owner: ClassroomGenerationJobOwner,
): Promise<ClassroomGenerationJob | null> {
  if (!requestKey) {
    return null;
  }

  if (isPostgresConfigured()) {
    const job = await findClassroomGenerationJobRecordByRequestKey(requestKey, owner);
    return job ? normalizeReusableRequestKeyJob(job) : null;
  }

  await ensureClassroomJobsDir();

  const claimedJob = await findReusableJobFromRequestKeyClaim(requestKey, owner);
  if (claimedJob) {
    return claimedJob;
  }

  const entries = await fs.readdir(CLASSROOM_JOBS_DIR, { withFileTypes: true });
  const matchingJobs = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
      .filter((entry) => !entry.name.startsWith('.request-key-'))
      .map(async (entry) => {
        const jobId = entry.name.replace(/\.json$/i, '');
        const job = await readClassroomGenerationJobFile(jobId, {
          applyStaleTimeout: false,
        }).catch(() => null);
        if (
          !job ||
          job.requestKey !== requestKey ||
          job.status === 'failed' ||
          !classroomGenerationJobOwnerMatches(job, owner)
        ) {
          return null;
        }
        return normalizeReusableRequestKeyJob(job);
      }),
  );

  return (
    matchingJobs
      .filter((job): job is ClassroomGenerationJob => job !== null)
      .sort(
        (left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
      )[0] ?? null
  );
}

export async function updateClassroomGenerationJob(
  jobId: string,
  patch: Partial<ClassroomGenerationJob>,
): Promise<ClassroomGenerationJob> {
  return withJobLock(jobId, async () => {
    const existing = await readClassroomGenerationJob(jobId);
    if (!existing) {
      throw new Error(`Classroom generation job not found: ${jobId}`);
    }

    const updated: ClassroomGenerationJob = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    if (isPostgresConfigured()) {
      const persisted = await updateClassroomGenerationJobRecord(updated);
      if (!persisted) {
        throw new Error(`Classroom generation job not found: ${jobId}`);
      }
      return persisted;
    }

    await writeJsonFileAtomic(jobFilePath(jobId), updated);
    return updated;
  });
}

export async function markClassroomGenerationJobRunning(
  jobId: string,
): Promise<ClassroomGenerationJob> {
  return withJobLock(jobId, async () => {
    const existing = await readClassroomGenerationJob(jobId);
    if (!existing) {
      throw new Error(`Classroom generation job not found: ${jobId}`);
    }

    const updated: ClassroomGenerationJob = {
      ...existing,
      status: 'running',
      startedAt: existing.startedAt || new Date().toISOString(),
      message: 'Classroom generation started',
      updatedAt: new Date().toISOString(),
    };

    if (isPostgresConfigured()) {
      const persisted = await updateClassroomGenerationJobRecord(updated);
      if (!persisted) {
        throw new Error(`Classroom generation job not found: ${jobId}`);
      }
      return persisted;
    }

    await writeJsonFileAtomic(jobFilePath(jobId), updated);
    return updated;
  });
}

export async function updateClassroomGenerationJobProgress(
  jobId: string,
  progress: ClassroomGenerationProgress,
): Promise<ClassroomGenerationJob> {
  return updateClassroomGenerationJob(jobId, {
    status: 'running',
    step: progress.step,
    progress: progress.progress,
    message: progress.message,
    scenesGenerated: progress.scenesGenerated,
    scenesFailed: progress.scenesFailed,
    totalScenes: progress.totalScenes,
    warnings: progress.warnings,
  });
}

export async function markClassroomGenerationJobSucceeded(
  jobId: string,
  result: GenerateClassroomResult,
  metadata: ClassroomGenerationJobSuccessMetadata = {},
): Promise<ClassroomGenerationJob> {
  return updateClassroomGenerationJob(jobId, {
    status: 'succeeded',
    step: 'completed',
    progress: 100,
    message: 'Classroom generation completed',
    completedAt: new Date().toISOString(),
    scenesGenerated: result.scenesCount,
    scenesFailed: result.sceneOutcomes.filter((outcome) => outcome.status === 'failed').length,
    totalScenes: result.totalScenes,
    completionStatus: result.completionStatus,
    warnings: result.warnings,
    sceneOutcomes: result.sceneOutcomes,
    ...(metadata.scheduledClassEvent ? { scheduledClassEvent: metadata.scheduledClassEvent } : {}),
    ...(metadata.scheduledClassError ? { scheduledClassError: metadata.scheduledClassError } : {}),
    canRetry: false,
    result: {
      classroomId: result.id,
      url: result.url,
      scenesCount: result.scenesCount,
      totalScenes: result.totalScenes,
      completionStatus: result.completionStatus,
      warnings: result.warnings,
      sceneOutcomes: result.sceneOutcomes,
    },
  });
}

export async function markClassroomGenerationJobFailed(
  jobId: string,
  error: string,
): Promise<ClassroomGenerationJob> {
  return updateClassroomGenerationJob(jobId, {
    status: 'failed',
    step: 'failed',
    message: 'Classroom generation failed',
    completedAt: new Date().toISOString(),
    completionStatus: 'failed',
    canRetry: true,
    error,
  });
}

export function canAccessClassroomGenerationJob(
  job: ClassroomGenerationJob,
  auth: AuthContext | null,
): boolean {
  if (!auth) {
    return false;
  }

  if (job.owner.organizationId && auth.organization?.id !== job.owner.organizationId) {
    return false;
  }

  if (auth.session.role === 'teacher' && job.owner.userId && auth.user.id !== job.owner.userId) {
    return false;
  }

  return true;
}
