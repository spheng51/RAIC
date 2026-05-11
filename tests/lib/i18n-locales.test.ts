import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { supportedLocales } from '@/lib/i18n';

function readLocaleMessages(code: string) {
  return JSON.parse(
    readFileSync(new URL(`../../lib/i18n/locales/${code}.json`, import.meta.url), 'utf8'),
  ) as {
    classroom?: {
      localDemoBadge?: string;
      localDemoNotice?: string;
      teacherBackedBadge?: string;
      mirofish?: Record<string, string | undefined>;
    };
    settings?: Record<string, string | undefined>;
    toolbar?: Record<string, string | undefined>;
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

  it('includes browser-local prerequisite hints in every supported locale', () => {
    for (const locale of supportedLocales) {
      const messages = readLocaleMessages(locale.code);
      const settings = messages.settings ?? {};

      expect(
        settings.browserLocalPermissionHint,
        `${locale.code} missing settings.browserLocalPermissionHint`,
      ).toBeTruthy();
      expect(
        settings.browserLocalLmstudioCorsHint,
        `${locale.code} missing settings.browserLocalLmstudioCorsHint`,
      ).toBeTruthy();
      expect(
        settings.activeModelDescription,
        `${locale.code} missing settings.activeModelDescription`,
      ).toBeTruthy();
      expect(
        settings.modelsManagementDescription,
        `${locale.code} missing settings.modelsManagementDescription`,
      ).toBeTruthy();
    }
  });

  it('includes generation toolbar labels in every supported locale', () => {
    for (const locale of supportedLocales) {
      const messages = readLocaleMessages(locale.code);
      const toolbar = messages.toolbar ?? {};

      expect(toolbar.uploadPdf, `${locale.code} missing toolbar.uploadPdf`).toBeTruthy();
      expect(
        toolbar.configureProvider,
        `${locale.code} missing toolbar.configureProvider`,
      ).toBeTruthy();
      expect(
        toolbar.configureProviderHint,
        `${locale.code} missing toolbar.configureProviderHint`,
      ).toBeTruthy();
    }
  });

  it('includes MiroFish manager strings in every supported locale', () => {
    const requiredKeys = [
      'dialogTitle',
      'modeCreate',
      'attachButtonShort',
      'manageButtonShort',
      'generatePlanButton',
      'createAndAttachButton',
      'manageButton',
      'surfaceLesson',
      'surfaceSimulation',
      'surfaceReport',
      'sharedPaneStatusTitle',
    ] as const;

    for (const locale of supportedLocales) {
      const messages = readLocaleMessages(locale.code);
      const mirofish = messages.classroom?.mirofish ?? {};

      for (const key of requiredKeys) {
        expect(mirofish[key], `${locale.code} missing classroom.mirofish.${key}`).toBeTruthy();
      }
    }
  });
});
