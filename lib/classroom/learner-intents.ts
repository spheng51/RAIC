export const LEARNER_INTENT_IDS = [
  'stuck',
  'example',
  'visual',
  'quiz',
  'harder',
  'easier',
] as const;

export type LearnerIntentId = (typeof LEARNER_INTENT_IDS)[number];

export interface LearnerIntentAction {
  readonly id: LearnerIntentId;
  readonly labelKey: string;
  readonly messageKey: string;
}

export const LEARNER_INTENT_ACTIONS: LearnerIntentAction[] = LEARNER_INTENT_IDS.map((id) => ({
  id,
  labelKey: `roundtable.quickActions.${id}`,
  messageKey: `roundtable.quickActionMessages.${id}`,
}));

export const TEACHER_STATE_LABEL_KEYS = {
  preparingHint: 'roundtable.teacherStates.preparingHint',
  adapting: 'roundtable.teacherStates.adapting',
  checking: 'roundtable.teacherStates.checking',
  thinking: 'roundtable.thinking',
} as const;

export function getTeacherStateLabelKey(input: {
  readonly isCueUser?: boolean;
  readonly isSendCooldown?: boolean;
  readonly thinkingStage?: string | null;
}): string {
  if (input.isCueUser) {
    return TEACHER_STATE_LABEL_KEYS.checking;
  }

  if (input.isSendCooldown) {
    return TEACHER_STATE_LABEL_KEYS.adapting;
  }

  if (input.thinkingStage === 'director') {
    return TEACHER_STATE_LABEL_KEYS.preparingHint;
  }

  return TEACHER_STATE_LABEL_KEYS.thinking;
}
