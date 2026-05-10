import 'server-only';

import { promises as fs } from 'fs';
import path from 'path';

const ATOMIC_WRITE_RETRY_CODES = new Set(['EACCES', 'EPERM', 'ENOENT']);
const ATOMIC_WRITE_MAX_ATTEMPTS = 4;
const ATOMIC_WRITE_RETRY_MS = 25;

export async function ensureDirPath(dir: string) {
  await fs.mkdir(dir, { recursive: true });
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
  await ensureDirPath(dir);

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
