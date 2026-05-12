import type { QuestionResult } from '@/lib/quiz/grading';

export const DRAFT_KEY_PREFIX = 'quizDraft:';
export const ANSWERS_KEY_PREFIX = 'quizAnswers:';
export const RESULTS_KEY_PREFIX = 'quizResults:';

export const draftKey = (sceneId: string): string => DRAFT_KEY_PREFIX + sceneId;

export type QuizAnswers = Record<string, string | string[]>;

export type SubmittedState =
  | { kind: 'reviewing'; answers: QuizAnswers; results: QuestionResult[] }
  | { kind: 'answering'; answers: QuizAnswers }
  | null;

function safeGet(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore quota / disabled storage
  }
}

function safeRemove(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore disabled storage
  }
}

export function readSubmittedState(sceneId: string): SubmittedState {
  const rawAnswers = safeGet(ANSWERS_KEY_PREFIX + sceneId);
  if (!rawAnswers) return null;
  try {
    const answers = JSON.parse(rawAnswers) as QuizAnswers;
    const rawResults = safeGet(RESULTS_KEY_PREFIX + sceneId);
    if (rawResults) {
      const results = JSON.parse(rawResults) as QuestionResult[];
      if (Array.isArray(results) && results.length > 0) {
        return { kind: 'reviewing', answers, results };
      }
    }
    return { kind: 'answering', answers };
  } catch {
    return null;
  }
}

export function readAnswersForSummary(sceneId: string): QuizAnswers {
  const rawAnswers = safeGet(ANSWERS_KEY_PREFIX + sceneId);
  if (rawAnswers) {
    try {
      return JSON.parse(rawAnswers) as QuizAnswers;
    } catch {
      // fall through
    }
  }

  const rawDraft = safeGet(DRAFT_KEY_PREFIX + sceneId);
  if (rawDraft) {
    try {
      return JSON.parse(rawDraft) as QuizAnswers;
    } catch {
      // fall through
    }
  }

  return {};
}

export function writeSubmittedAnswers(sceneId: string, answers: QuizAnswers): void {
  safeSet(ANSWERS_KEY_PREFIX + sceneId, JSON.stringify(answers));
}

export function writeSubmittedResults(sceneId: string, results: QuestionResult[]): void {
  safeSet(RESULTS_KEY_PREFIX + sceneId, JSON.stringify(results));
}

export function clearSubmitted(sceneId: string): void {
  safeRemove(ANSWERS_KEY_PREFIX + sceneId);
  safeRemove(RESULTS_KEY_PREFIX + sceneId);
}

export function clearAllForScene(sceneId: string): void {
  safeRemove(DRAFT_KEY_PREFIX + sceneId);
  safeRemove(ANSWERS_KEY_PREFIX + sceneId);
  safeRemove(RESULTS_KEY_PREFIX + sceneId);
}
