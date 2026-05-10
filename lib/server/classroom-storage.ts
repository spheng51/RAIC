import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import { isPostgresConfigured } from '@/lib/db/client';
import {
  readClassroomRecord,
  updateClassroomRecord,
  upsertClassroomRecord,
} from '@/lib/db/repositories/classrooms';
import type { ClassroomRecord } from '@/lib/db/schema';
import { createLogger } from '@/lib/logger';
import { ensureDirPath, writeJsonFileAtomic } from '@/lib/server/json-file';
import type { Scene, Stage } from '@/lib/types/stage';
import { preserveStageSharedSimulation } from '@/lib/utils/classroom-presentation';
import { getDataPath } from '@/lib/server/data-root';

export const CLASSROOMS_DIR = getDataPath('classrooms');
export const CLASSROOM_JOBS_DIR = getDataPath('classroom-jobs');
const classroomWriteLocks = new Map<string, Promise<void>>();
const log = createLogger('classroom-storage');

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
  await ensureDirPath(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDirPath(CLASSROOM_JOBS_DIR);
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

type PersistedClassroomLike =
  | PersistedClassroomData
  | ClassroomRecord
  | (Omit<PersistedClassroomData, 'ownerUserId' | 'organizationId'> & {
      ownerUserId?: string | null;
      organizationId?: string | null;
      updatedAt?: string;
    });

function normalizePersistedClassroomData(value: PersistedClassroomLike): PersistedClassroomData {
  return {
    id: value.id,
    ownerUserId: typeof value.ownerUserId === 'string' ? value.ownerUserId : null,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : null,
    roomVersion:
      typeof (value as { roomVersion?: unknown }).roomVersion === 'number' &&
      Number.isFinite((value as { roomVersion?: number }).roomVersion)
        ? Math.max(0, Math.floor((value as { roomVersion?: number }).roomVersion ?? 0))
        : 0,
    stage: preserveStageSharedSimulation(value.stage, value.stage.sharedSimulation ?? null),
    scenes: Array.isArray(value.scenes) ? value.scenes : [],
    createdAt: value.createdAt,
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
  if (!isValidClassroomId(id)) {
    throw new Error('Invalid classroom id');
  }

  if (isPostgresConfigured()) {
    const record = await readClassroomRecord(id);
    if (!record) {
      log.warn('Classroom read miss', { classroomId: id, backend: 'postgres' });
      return null;
    }
    return normalizePersistedClassroomData(record);
  }

  const filePath = resolveClassroomJsonPath(id);
  try {
    const content = await fs.readFile(filePath, 'utf-8');
    return normalizePersistedClassroomData(JSON.parse(content) as PersistedClassroomData);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      log.warn('Classroom read miss', { classroomId: id, backend: 'json' });
      return null;
    }
    throw error;
  }
}

async function writePersistedClassroomData(data: PersistedClassroomData) {
  if (isPostgresConfigured()) {
    const now = new Date().toISOString();
    const record = await upsertClassroomRecord({
      ...data,
      updatedAt: now,
    });
    if (!record) {
      throw new Error('DATABASE_URL is configured, but classroom upsert did not return a record');
    }
    return;
  }

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

function buildUpdatedClassroom(
  existing: PersistedClassroomData,
  updater: (current: PersistedClassroomData) => PersistedClassroomData,
): PersistedClassroomData {
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
  return {
    ...normalizedNext,
    id: existing.id,
    roomVersion: nextRoomVersion,
  };
}

function assertVerifiedClassroomWrite(
  expected: PersistedClassroomData,
  actual: PersistedClassroomData | null,
) {
  if (!actual) {
    throw new Error(`Classroom persistence verification failed: ${expected.id} was not readable`);
  }
  if (actual.id !== expected.id) {
    throw new Error(
      `Classroom persistence verification failed: expected id ${expected.id}, got ${actual.id}`,
    );
  }
  if (actual.stage.id !== expected.id) {
    throw new Error(
      `Classroom persistence verification failed: expected stage.id ${expected.id}, got ${actual.stage.id}`,
    );
  }
  if (actual.scenes.length !== expected.scenes.length) {
    throw new Error(
      `Classroom persistence verification failed: expected ${expected.scenes.length} scenes, got ${actual.scenes.length}`,
    );
  }
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
  const canonicalStage = { ...data.stage, id: data.id };
  const classroomData: PersistedClassroomData = {
    id: data.id,
    ownerUserId: data.ownerUserId ?? null,
    organizationId: data.organizationId ?? null,
    roomVersion: 0,
    stage: preserveStageSharedSimulation(canonicalStage, canonicalStage.sharedSimulation),
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
  };

  log.info('Classroom persist start', {
    classroomId: classroomData.id,
    ownerUserId: classroomData.ownerUserId,
    organizationId: classroomData.organizationId,
    sceneCount: classroomData.scenes.length,
    backend: isPostgresConfigured() ? 'postgres' : 'json',
  });

  await withClassroomWriteLock(data.id, async () => {
    await writePersistedClassroomData(classroomData);
  });

  log.info('Classroom persist write complete', {
    classroomId: classroomData.id,
    backend: isPostgresConfigured() ? 'postgres' : 'json',
  });

  const verified = await readClassroom(data.id);
  assertVerifiedClassroomWrite(classroomData, verified);

  log.info('Classroom persist read-back verified', {
    classroomId: classroomData.id,
    sceneCount: verified?.scenes.length ?? 0,
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
  if (isPostgresConfigured()) {
    const updated = await updateClassroomRecord(id, (current) => {
      const finalNext = buildUpdatedClassroom(normalizePersistedClassroomData(current), updater);
      return {
        ...finalNext,
        updatedAt: new Date().toISOString(),
      };
    });
    if (!updated) {
      log.warn('Classroom update miss', { classroomId: id, backend: 'postgres' });
      return null;
    }
    return normalizePersistedClassroomData(updated);
  }

  return withClassroomWriteLock(id, async () => {
    const existing = await readClassroom(id);
    if (!existing) {
      return null;
    }

    const finalNext = buildUpdatedClassroom(existing, updater);
    await writePersistedClassroomData(finalNext);
    return finalNext;
  });
}
