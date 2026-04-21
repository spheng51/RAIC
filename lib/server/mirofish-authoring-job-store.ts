import 'server-only';

import { promises as fs } from 'fs';
import path from 'node:path';
import type { PlatformRole } from '@/lib/db/schema';
import { writeJsonFileAtomic } from '@/lib/server/classroom-storage';
import type {
  MiroFishCreationJobStatus,
  MiroFishCreationSpec,
} from '@/lib/types/mirofish-authoring';
import type { SharedSimulation } from '@/lib/types/stage';

const MIROFISH_AUTHORING_JOBS_DIR = path.join(process.cwd(), 'data', 'mirofish-authoring-jobs');
const jobLocks = new Map<string, Promise<void>>();

export interface MiroFishCreationJobOwner {
  organizationId: string | null;
  userId: string | null;
  actorRole: PlatformRole | null;
}

export interface MiroFishCreationJobRecord {
  id: string;
  classroomId: string;
  externalJobId: string;
  status: MiroFishCreationJobStatus;
  owner: MiroFishCreationJobOwner;
  spec: MiroFishCreationSpec;
  briefPreview: string;
  attempt: number;
  maxAttempts: number;
  canRetry: boolean;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
  error?: string;
  sharedSimulation?: SharedSimulation;
}

function jobFilePath(jobId: string) {
  return path.join(MIROFISH_AUTHORING_JOBS_DIR, `${jobId}.json`);
}

async function ensureMiroFishAuthoringJobsDir() {
  await fs.mkdir(MIROFISH_AUTHORING_JOBS_DIR, { recursive: true });
}

async function withJobLock<T>(jobId: string, fn: () => Promise<T>): Promise<T> {
  const previous = jobLocks.get(jobId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  jobLocks.set(
    jobId,
    previous.then(
      () => current,
      () => current,
    ),
  );

  await previous.catch(() => undefined);

  try {
    return await fn();
  } finally {
    releaseCurrent();
    if (jobLocks.get(jobId) === current) {
      jobLocks.delete(jobId);
    }
  }
}

export function isValidMiroFishCreationJobId(jobId: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(jobId);
}

export async function createMiroFishCreationJob(
  job: MiroFishCreationJobRecord,
): Promise<MiroFishCreationJobRecord> {
  await ensureMiroFishAuthoringJobsDir();
  await writeJsonFileAtomic(jobFilePath(job.id), job);
  return job;
}

export async function readMiroFishCreationJob(
  jobId: string,
): Promise<MiroFishCreationJobRecord | null> {
  try {
    const content = await fs.readFile(jobFilePath(jobId), 'utf-8');
    return JSON.parse(content) as MiroFishCreationJobRecord;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function updateMiroFishCreationJob(
  jobId: string,
  patch: Partial<MiroFishCreationJobRecord>,
): Promise<MiroFishCreationJobRecord> {
  return withJobLock(jobId, async () => {
    const existing = await readMiroFishCreationJob(jobId);
    if (!existing) {
      throw new Error(`MiroFish creation job not found: ${jobId}`);
    }

    const updated: MiroFishCreationJobRecord = {
      ...existing,
      ...patch,
      updatedAt: new Date().toISOString(),
    };

    await writeJsonFileAtomic(jobFilePath(jobId), updated);
    return updated;
  });
}

export function canAccessMiroFishCreationJob(
  job: MiroFishCreationJobRecord,
  owner: MiroFishCreationJobOwner,
): boolean {
  if (job.owner.organizationId && job.owner.organizationId !== owner.organizationId) {
    return false;
  }
  if (owner.actorRole === 'teacher' && job.owner.userId && job.owner.userId !== owner.userId) {
    return false;
  }
  return true;
}
