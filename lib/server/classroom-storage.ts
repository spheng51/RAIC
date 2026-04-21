import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';
import { preserveStageSharedSimulation } from '@/lib/utils/classroom-presentation';
import { getDataPath } from '@/lib/server/data-root';

export const CLASSROOMS_DIR = getDataPath('classrooms');
export const CLASSROOM_JOBS_DIR = getDataPath('classroom-jobs');
const ATOMIC_WRITE_RETRY_CODES = new Set(['EACCES', 'EPERM', 'ENOENT']);
const ATOMIC_WRITE_MAX_ATTEMPTS = 4;
const ATOMIC_WRITE_RETRY_MS = 25;
const classroomWriteLocks = new Map<string, Promise<void>>();

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

async function withClassroomWriteLock<T>(
  classroomId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const previous = classroomWriteLocks.get(classroomId) ?? Promise.resolve();
  let releaseCurrent!: () => void;
  const current = new Promise<void>((resolve) => {
    releaseCurrent = resolve;
  });
  classroomWriteLocks.set(
    classroomId,
    previous.then(
      () => current,
      () => current,
    ),
  );

  await previous.catch(() => undefined);

  try {
    return await operation();
  } finally {
    releaseCurrent();
    if (classroomWriteLocks.get(classroomId) === current) {
      classroomWriteLocks.delete(classroomId);
    }
  }
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

function isRetryableAtomicWriteError(error: unknown): error is NodeJS.ErrnoException {
  return (
    !!error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as NodeJS.ErrnoException).code === 'string' &&
    ATOMIC_WRITE_RETRY_CODES.has((error as NodeJS.ErrnoException).code ?? '')
  );
}

async function waitForAtomicWriteRetry(attempt: number) {
  await new Promise((resolve) => setTimeout(resolve, ATOMIC_WRITE_RETRY_MS * attempt));
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  for (let attempt = 1; attempt <= ATOMIC_WRITE_MAX_ATTEMPTS; attempt += 1) {
    try {
      await fs.writeFile(tempFilePath, content, 'utf-8');
      await fs.rename(tempFilePath, filePath);
      return;
    } catch (error) {
      if (!isRetryableAtomicWriteError(error) || attempt === ATOMIC_WRITE_MAX_ATTEMPTS) {
        throw error;
      }

      await fs.rm(filePath, { force: true }).catch(() => undefined);
      await fs.rm(tempFilePath, { force: true }).catch(() => undefined);
      await waitForAtomicWriteRetry(attempt);
    }
  }
}

function normalizeAppBaseUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('APP_BASE_URL must use http or https');
  }
  return parsed.origin;
}

export function buildRequestOrigin(req: NextRequest): string {
  const configuredBaseUrl = process.env.APP_BASE_URL?.trim();
  return configuredBaseUrl ? normalizeAppBaseUrl(configuredBaseUrl) : req.nextUrl.origin;
}

export interface PersistedClassroomData {
  id: string;
  ownerUserId: string | null;
  organizationId: string | null;
  roomVersion: number;
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
}

function normalizePersistedClassroomData(
  value:
    | PersistedClassroomData
    | (Omit<PersistedClassroomData, 'ownerUserId' | 'organizationId'> & {
        ownerUserId?: string | null;
        organizationId?: string | null;
      }),
): PersistedClassroomData {
  return {
    ...value,
    ownerUserId: typeof value.ownerUserId === 'string' ? value.ownerUserId : null,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : null,
    roomVersion:
      typeof (value as { roomVersion?: unknown }).roomVersion === 'number' &&
      Number.isFinite((value as { roomVersion?: number }).roomVersion)
        ? Math.max(0, Math.floor((value as { roomVersion?: number }).roomVersion ?? 0))
        : 0,
    stage: preserveStageSharedSimulation(value.stage, value.stage.sharedSimulation ?? null),
  };
}

export function isValidClassroomId(id: string): boolean {
  return /^[a-zA-Z0-9_-]+$/.test(id);
}

export function resolveClassroomJsonPath(id: string): string {
  if (!isValidClassroomId(id)) {
    throw new Error('Invalid classroom id');
  }

  const resolvedBase = path.resolve(CLASSROOMS_DIR);
  const resolvedFilePath = path.resolve(CLASSROOMS_DIR, `${id}.json`);
  const relativePath = path.relative(resolvedBase, resolvedFilePath);

  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('Resolved classroom path escapes data directory');
  }

  return resolvedFilePath;
}

export async function readClassroom(id: string): Promise<PersistedClassroomData | null> {
  const filePath = resolveClassroomJsonPath(id);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return normalizePersistedClassroomData(JSON.parse(content) as PersistedClassroomData);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

async function writePersistedClassroomData(data: PersistedClassroomData) {
  await ensureClassroomsDir();
  const filePath = resolveClassroomJsonPath(data.id);
  await writeJsonFileAtomic(filePath, data);
}

function buildClassroomComparablePayload(data: PersistedClassroomData) {
  return JSON.stringify({
    ownerUserId: data.ownerUserId,
    organizationId: data.organizationId,
    roomVersion: data.roomVersion,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: data.createdAt,
  });
}

export async function persistClassroom(
  data: {
    id: string;
    ownerUserId?: string | null;
    organizationId?: string | null;
    stage: Stage;
    scenes: Scene[];
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    ownerUserId: data.ownerUserId ?? null,
    organizationId: data.organizationId ?? null,
    roomVersion: 0,
    stage: preserveStageSharedSimulation(data.stage, data.stage.sharedSimulation),
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
  };

  await withClassroomWriteLock(data.id, async () => {
    await writePersistedClassroomData(classroomData);
  });

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}

export async function updateClassroom(
  id: string,
  updater: (current: PersistedClassroomData) => PersistedClassroomData,
): Promise<PersistedClassroomData | null> {
  return withClassroomWriteLock(id, async () => {
    const existing = await readClassroom(id);
    if (!existing) {
      return null;
    }

    const next = updater(existing);
    const preservedStage = preserveStageSharedSimulation(
      next.stage,
      next.stage.sharedSimulation ?? existing.stage.sharedSimulation ?? null,
    );
    const normalizedNext = normalizePersistedClassroomData(
      preservedStage === next.stage
        ? next
        : {
            ...next,
            stage: preservedStage,
          },
    );
    const nextRoomVersion =
      buildClassroomComparablePayload({
        ...existing,
        roomVersion: existing.roomVersion,
      }) ===
      buildClassroomComparablePayload({
        ...normalizedNext,
        roomVersion: existing.roomVersion,
      })
        ? existing.roomVersion
        : existing.roomVersion + 1;
    const finalNext = {
      ...normalizedNext,
      roomVersion: nextRoomVersion,
    };
    await writePersistedClassroomData(finalNext);
    return finalNext;
  });
}
