import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { supportedLocales } from '@/lib/i18n';

function readLocaleMessages(code: string) {
  return JSON.parse(
    readFileSync(new URL(`../../lib/i18n/locales/${code}.json`, import.meta.url), 'utf8'),
  ) as {
    classroom?: Record<string, string | undefined>;
  };
}

describe('locale resource parity', () => {
  it('includes classroom source labels and notices in every supported locale', () => {
    for (const locale of supportedLocales) {
      const messages = readLocaleMessages(locale.code);
      const classroom = messages.classroom ?? {};

      expect(
        classroom.localDemoBadge,
        `${locale.code} missing classroom.localDemoBadge`,
      ).toBeTruthy();
      expect(
        classroom.localDemoNotice,
        `${locale.code} missing classroom.localDemoNotice`,
      ).toBeTruthy();
      expect(
        classroom.teacherBackedBadge,
        `${locale.code} missing classroom.teacherBackedBadge`,
      ).toBeTruthy();
    }
  });
});
