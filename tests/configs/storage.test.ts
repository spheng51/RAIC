import { describe, expect, it } from 'vitest';
import { LOCALSTORAGE_KEY_DISCARDED_DB } from '@/configs/storage';

const LEGACY_DISCARDED_DB_KEY = ['MAIC', '_DISCARDED_DB'].join('');

describe('storage config', () => {
  it('uses the renamed discarded-db browser-storage key', () => {
    expect(LOCALSTORAGE_KEY_DISCARDED_DB).toBe('RAIC_DISCARDED_DB');
    expect(LOCALSTORAGE_KEY_DISCARDED_DB).not.toBe(LEGACY_DISCARDED_DB_KEY);
  });
});
