import os from 'node:os';
import path from 'node:path';

function isHostedServerlessRuntime() {
  return Boolean(
    process.env.VERCEL?.trim() ||
      process.env.AWS_EXECUTION_ENV?.trim() ||
      process.env.LAMBDA_TASK_ROOT?.trim(),
  );
}

export function getDataRootDir() {
  if (isHostedServerlessRuntime()) {
    return path.join(os.tmpdir(), 'openraic-data');
  }

  return path.join(process.cwd(), 'data');
}

export function getDataPath(...segments: string[]) {
  return path.join(getDataRootDir(), ...segments);
}

export function isHostedEphemeralDataRoot() {
  return isHostedServerlessRuntime();
}
