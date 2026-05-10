import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import resourcesToBackend from 'i18next-resources-to-backend';
import { supportedLocales } from './locales';
import { defaultLocale } from './types';

const missingKeyFallbacks: Record<string, string> = {
  'classroom.classroomNotFound': 'Classroom not found',
  'classroom.teacherAccessMissing': 'Sign in again to open this teacher-backed classroom.',
  'classroom.serverAccessDenied': 'You do not have access to this classroom.',
};

i18n
  .use(initReactI18next)
  .use(resourcesToBackend((language: string) => import(`./locales/${language}.json`)))
  .init({
    lng: defaultLocale,
    fallbackLng: defaultLocale,
    supportedLngs: supportedLocales.map((l) => l.code),
    interpolation: {
      escapeValue: false,
    },
    parseMissingKeyHandler: (key) => missingKeyFallbacks[key] ?? key,
  });

export default i18n;
