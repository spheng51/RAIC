import 'server-only';

import type { ClassroomAccessContext } from '@/lib/auth/classroom-access';

export const STUDENT_ADAPTATION_BETA_ENV = 'RAIC_STUDENT_ADAPTATION_BETA';

type FlagEnvironment = Record<string, string | undefined>;

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);

export function isStudentAdaptationBetaEnabled(env: FlagEnvironment = process.env): boolean {
  const rawValue = env[STUDENT_ADAPTATION_BETA_ENV]?.trim().toLowerCase();
  return rawValue ? TRUE_VALUES.has(rawValue) : false;
}

export function canUseTeacherAdaptiveContext(access: ClassroomAccessContext): boolean {
  return access.source === 'web' && access.auth.session.role === 'teacher';
}

export function canUseStudentAdaptiveContext(input: {
  access: ClassroomAccessContext;
  hasConsent?: boolean;
  env?: FlagEnvironment;
}): boolean {
  return (
    isStudentAdaptationBetaEnabled(input.env) &&
    input.hasConsent === true &&
    input.access.auth.session.role === 'student'
  );
}

export function shouldLoadAdaptiveRuntimeContext(input: {
  access: ClassroomAccessContext;
  studentConsent?: boolean;
  env?: FlagEnvironment;
}): boolean {
  if (canUseTeacherAdaptiveContext(input.access)) {
    return true;
  }

  return canUseStudentAdaptiveContext({
    access: input.access,
    hasConsent: input.studentConsent,
    env: input.env,
  });
}
