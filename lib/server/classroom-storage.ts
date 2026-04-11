import { promises as fs } from 'fs';
import path from 'path';
import type { NextRequest } from 'next/server';
import type { Scene, Stage } from '@/lib/types/stage';

export const CLASSROOMS_DIR = path.join(process.cwd(), 'data', 'classrooms');
export const CLASSROOM_JOBS_DIR = path.join(process.cwd(), 'data', 'classroom-jobs');

async function ensureDir(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}

export async function ensureClassroomsDir() {
  await ensureDir(CLASSROOMS_DIR);
}

export async function ensureClassroomJobsDir() {
  await ensureDir(CLASSROOM_JOBS_DIR);
}

export async function writeJsonFileAtomic(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  await ensureDir(dir);

  const tempFilePath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const content = JSON.stringify(data, null, 2);
  await fs.writeFile(tempFilePath, content, 'utf-8');
  await fs.rename(tempFilePath, filePath);
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
  stage: Stage;
  scenes: Scene[];
  createdAt: string;
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
    return JSON.parse(content) as PersistedClassroomData;
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

export async function persistClassroom(
  data: {
    id: string;
    stage: Stage;
    scenes: Scene[];
  },
  baseUrl: string,
): Promise<PersistedClassroomData & { url: string }> {
  const classroomData: PersistedClassroomData = {
    id: data.id,
    stage: data.stage,
    scenes: data.scenes,
    createdAt: new Date().toISOString(),
  };

  await writePersistedClassroomData(classroomData);

  return {
    ...classroomData,
    url: `${baseUrl}/classroom/${data.id}`,
  };
}

export async function updateClassroom(
  id: string,
  updater: (current: PersistedClassroomData) => PersistedClassroomData,
): Promise<PersistedClassroomData | null> {
  const existing = await readClassroom(id);
  if (!existing) {
    return null;
  }

  const next = updater(existing);
  await writePersistedClassroomData(next);
  return next;
}
