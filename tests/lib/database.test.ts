import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LEGACY_DATABASE_NAME = ['MAIC', '-Database'].join('');
const LEGACY_DISCARDED_DB_KEY = ['MAIC', '_DISCARDED_DB'].join('');

describe('database browser-state markers', () => {
  let persistMock: ReturnType<typeof vi.fn>;
  let storage: {
    getItem: ReturnType<typeof vi.fn>;
    setItem: ReturnType<typeof vi.fn>;
    removeItem: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    vi.resetModules();
    persistMock = vi.fn();
    storage = {
      getItem: vi.fn(),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    vi.stubGlobal('localStorage', storage);
    vi.stubGlobal('navigator', {
      storage: {
        persist: persistMock,
      },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('marks the renamed discarded-db key when clearing the renamed local database', async () => {
    const database = await import('@/lib/utils/database');
    vi.spyOn(database.db, 'delete').mockResolvedValue(undefined as never);

    await database.clearDatabase();

    expect(storage.setItem).toHaveBeenCalledTimes(1);
    expect(storage.setItem).toHaveBeenCalledWith('RAIC_DISCARDED_DB', 'RAIC-Database');
    expect(storage.setItem).not.toHaveBeenCalledWith(LEGACY_DISCARDED_DB_KEY, LEGACY_DATABASE_NAME);
  });

  it('clears the renamed discarded-db key after the renamed local database opens', async () => {
    const database = await import('@/lib/utils/database');
    vi.spyOn(database.db, 'open').mockResolvedValue(database.db as never);

    await database.initDatabase();

    expect(storage.removeItem).toHaveBeenCalledTimes(1);
    expect(storage.removeItem).toHaveBeenCalledWith('RAIC_DISCARDED_DB');
    expect(storage.removeItem).not.toHaveBeenCalledWith(LEGACY_DISCARDED_DB_KEY);
    expect(persistMock).toHaveBeenCalledTimes(1);
  });
});
