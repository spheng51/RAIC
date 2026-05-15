import {
  buildOpenRaicRitDemoCoursePayload,
  EXAMPLE_COURSE_ID,
  EXAMPLE_COURSE_SEED_VERSION,
} from '@/lib/data/openraic-rit-demo';
import {
  deleteStageData,
  saveStageData,
  stageExists,
  type StageStoreData,
} from '@/lib/utils/stage-storage';

const EXAMPLE_COURSE_SEED_VERSION_KEY = 'openraic-example-course-seed-version';

function readStoredSeedVersion(): number | null {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(EXAMPLE_COURSE_SEED_VERSION_KEY);
  if (!raw) {
    return null;
  }

  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function writeStoredSeedVersion(version: number): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(EXAMPLE_COURSE_SEED_VERSION_KEY, String(version));
  } catch {
    /* ignore */
  }
}

function clearStoredSeedVersion(): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    localStorage.removeItem(EXAMPLE_COURSE_SEED_VERSION_KEY);
  } catch {
    /* ignore */
  }
}

export async function clearExampleIfSchemaChanged(): Promise<void> {
  const storedVersion = readStoredSeedVersion();
  if (storedVersion === null || storedVersion === EXAMPLE_COURSE_SEED_VERSION) {
    return;
  }

  clearStoredSeedVersion();
  try {
    const hasExisting = await stageExists(EXAMPLE_COURSE_ID);
    if (hasExisting) {
      await deleteStageData(EXAMPLE_COURSE_ID);
    }
  } catch {
    /* ignore */
  }
}

export async function ensureOpenRaicExampleSeeded(force = false): Promise<void> {
  await clearExampleIfSchemaChanged();
  const storedVersion = readStoredSeedVersion();

  const shouldSeed =
    force || storedVersion === null || storedVersion !== EXAMPLE_COURSE_SEED_VERSION;
  const stageAlreadyExists = await stageExists(EXAMPLE_COURSE_ID);

  if (!shouldSeed && stageAlreadyExists) {
    return;
  }

  if (stageAlreadyExists) {
    await deleteStageData(EXAMPLE_COURSE_ID);
  }

  const payload: StageStoreData = buildOpenRaicRitDemoCoursePayload(Date.now());
  await saveStageData(payload.stage.id, payload);
  writeStoredSeedVersion(EXAMPLE_COURSE_SEED_VERSION);
}

export { EXAMPLE_COURSE_ID, EXAMPLE_COURSE_SEED_VERSION };
