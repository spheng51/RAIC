// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  ANSWERS_KEY_PREFIX,
  DRAFT_KEY_PREFIX,
  RESULTS_KEY_PREFIX,
  clearAllForScene,
  clearSubmitted,
  draftKey,
  readAnswersForSummary,
  readSubmittedState,
  writeSubmittedAnswers,
  writeSubmittedResults,
} from '@/lib/quiz/persistence';

describe('quiz persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('uses stable quiz storage key prefixes', () => {
    expect(draftKey('scene-1')).toBe('quizDraft:scene-1');
    expect(ANSWERS_KEY_PREFIX).toBe('quizAnswers:');
    expect(RESULTS_KEY_PREFIX).toBe('quizResults:');
  });

  it('hydrates submitted answers and results', () => {
    writeSubmittedAnswers('scene-1', { q1: 'A' });
    writeSubmittedResults('scene-1', [
      { questionId: 'q1', correct: true, status: 'correct', earned: 1 },
    ]);

    expect(readSubmittedState('scene-1')).toEqual({
      kind: 'reviewing',
      answers: { q1: 'A' },
      results: [{ questionId: 'q1', correct: true, status: 'correct', earned: 1 }],
    });
  });

  it('falls back to drafts for completion summaries', () => {
    localStorage.setItem(`${DRAFT_KEY_PREFIX}scene-1`, JSON.stringify({ q1: 'B' }));

    expect(readAnswersForSummary('scene-1')).toEqual({ q1: 'B' });

    clearSubmitted('scene-1');
    expect(readAnswersForSummary('scene-1')).toEqual({ q1: 'B' });

    clearAllForScene('scene-1');
    expect(readAnswersForSummary('scene-1')).toEqual({});
  });
});
