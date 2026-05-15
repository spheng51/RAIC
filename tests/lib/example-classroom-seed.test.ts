// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const stageStorageMocks = vi.hoisted(() => ({
  stageExists: vi.fn(),
  saveStageData: vi.fn(),
  deleteStageData: vi.fn(),
}));

vi.mock('@/lib/utils/stage-storage', () => ({
  stageExists: stageStorageMocks.stageExists,
  saveStageData: stageStorageMocks.saveStageData,
  deleteStageData: stageStorageMocks.deleteStageData,
}));

const EXAMPLE_VERSION_KEY = 'openraic-example-course-seed-version';

describe('example classroom seed helper', () => {
  beforeEach(() => {
    localStorage.clear();
    stageStorageMocks.stageExists.mockReset();
    stageStorageMocks.saveStageData.mockReset();
    stageStorageMocks.deleteStageData.mockReset();
  });

  it('creates a seeded example classroom and records the seed version when missing', async () => {
    const module = await import('@/lib/utils/example-classroom-seed');
    stageStorageMocks.stageExists.mockResolvedValue(false);
    stageStorageMocks.saveStageData.mockResolvedValue(undefined);

    await module.ensureOpenRaicExampleSeeded();

    expect(stageStorageMocks.stageExists).toHaveBeenCalledWith(module.EXAMPLE_COURSE_ID);
    expect(stageStorageMocks.saveStageData).toHaveBeenCalledTimes(1);
    expect(stageStorageMocks.deleteStageData).not.toHaveBeenCalled();
    expect(localStorage.getItem(EXAMPLE_VERSION_KEY)).toBe(
      String(module.EXAMPLE_COURSE_SEED_VERSION),
    );
  });

  it('does nothing when version is unchanged and stage already exists', async () => {
    const module = await import('@/lib/utils/example-classroom-seed');
    localStorage.setItem(EXAMPLE_VERSION_KEY, String(module.EXAMPLE_COURSE_SEED_VERSION));
    stageStorageMocks.stageExists.mockResolvedValue(true);

    await module.ensureOpenRaicExampleSeeded();

    expect(stageStorageMocks.stageExists).toHaveBeenCalledWith(module.EXAMPLE_COURSE_ID);
    expect(stageStorageMocks.saveStageData).not.toHaveBeenCalled();
    expect(stageStorageMocks.deleteStageData).not.toHaveBeenCalled();
  });

  it('refreshes seeded classroom payload when version changes', async () => {
    const module = await import('@/lib/utils/example-classroom-seed');
    localStorage.setItem(EXAMPLE_VERSION_KEY, '0');
    stageStorageMocks.stageExists.mockResolvedValue(true);
    stageStorageMocks.saveStageData.mockResolvedValue(undefined);

    await module.ensureOpenRaicExampleSeeded();

    expect(stageStorageMocks.deleteStageData).toHaveBeenCalledWith(module.EXAMPLE_COURSE_ID);
    expect(stageStorageMocks.saveStageData).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(EXAMPLE_VERSION_KEY)).toBe(
      String(module.EXAMPLE_COURSE_SEED_VERSION),
    );
  });

  it('clears seeded example data on schema-version drift', async () => {
    const module = await import('@/lib/utils/example-classroom-seed');
    localStorage.setItem(EXAMPLE_VERSION_KEY, '0');
    stageStorageMocks.stageExists.mockResolvedValue(true);

    await module.clearExampleIfSchemaChanged();

    expect(stageStorageMocks.deleteStageData).toHaveBeenCalledWith(module.EXAMPLE_COURSE_ID);
    expect(localStorage.getItem(EXAMPLE_VERSION_KEY)).toBeNull();
  });
});
