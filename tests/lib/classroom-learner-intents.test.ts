import { describe, expect, it } from 'vitest';

import {
  LEARNER_INTENT_ACTIONS,
  LEARNER_INTENT_IDS,
  getTeacherStateLabelKey,
} from '@/lib/classroom/learner-intents';

describe('classroom learner intents', () => {
  it('exposes the cheap classroom action chips as chat intents', () => {
    expect(LEARNER_INTENT_ACTIONS.map((action) => action.id)).toEqual([...LEARNER_INTENT_IDS]);
    expect(LEARNER_INTENT_ACTIONS).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'stuck',
          labelKey: 'roundtable.quickActions.stuck',
          messageKey: 'roundtable.quickActionMessages.stuck',
        }),
        expect.objectContaining({
          id: 'quiz',
          labelKey: 'roundtable.quickActions.quiz',
          messageKey: 'roundtable.quickActionMessages.quiz',
        }),
      ]),
    );
  });

  it('uses warmer teacher state labels for live tutoring states', () => {
    expect(getTeacherStateLabelKey({ isCueUser: true, isSendCooldown: true })).toBe(
      'roundtable.teacherStates.checking',
    );
    expect(getTeacherStateLabelKey({ isSendCooldown: true })).toBe(
      'roundtable.teacherStates.adapting',
    );
    expect(getTeacherStateLabelKey({ thinkingStage: 'director' })).toBe(
      'roundtable.teacherStates.preparingHint',
    );
    expect(getTeacherStateLabelKey({ thinkingStage: 'agent_loading' })).toBe('roundtable.thinking');
  });
});
