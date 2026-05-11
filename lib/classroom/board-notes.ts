import {
  LESSON_STAGE_LABELS,
  type ClassroomLessonState,
  type LessonStageId,
} from '@/lib/classroom/lesson-state';
import type { Scene } from '@/lib/types/stage';

export interface BoardNotes {
  readonly keyIdea: string;
  readonly example: string;
  readonly steps: readonly string[];
  readonly practicePrompt: string;
}

const STAGE_STEPS: Record<LessonStageId, readonly string[]> = {
  intro: ['Confirm the goal', 'Name what you know', 'Ask one question'],
  explain: ['Find the key term', 'Follow one chunk', 'Ask for simpler wording'],
  example: ['Compare rule to case', 'Trace the steps', 'Ask for another example'],
  practice: ['Try a short answer', 'Use a hint if stuck', 'Revise once'],
  check: ['Answer the check', 'Explain why', 'Pick harder or easier'],
  recap: ['Restate the takeaway', 'Name the next step', 'Save one question'],
};

function compactText(value: string, fallback: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim() || fallback;
  return normalized.length > 74 ? `${normalized.slice(0, 71)}...` : normalized;
}

function exampleForStage(stageId: LessonStageId, focus: string): string {
  switch (stageId) {
    case 'intro':
      return `Connect ${focus} to something you already know.`;
    case 'explain':
      return `Ask the teacher to unpack one part of ${focus}.`;
    case 'example':
      return `Trace one worked case, then change one detail.`;
    case 'practice':
      return `Try the next step before asking for the answer.`;
    case 'check':
      return `Answer briefly, then explain your reasoning.`;
    case 'recap':
      return `Say the main idea back in your own words.`;
    default:
      return `Use one concrete example for ${focus}.`;
  }
}

export function buildBoardNotes(input: {
  readonly lessonState: ClassroomLessonState;
  readonly currentScene?: Scene | null;
}): BoardNotes {
  const { lessonState, currentScene } = input;
  const focus = compactText(currentScene?.title || lessonState.goal, lessonState.goal);
  const stageLabel = LESSON_STAGE_LABELS[lessonState.currentStage];

  return {
    keyIdea: focus,
    example: exampleForStage(lessonState.currentStage, focus),
    steps: STAGE_STEPS[lessonState.currentStage],
    practicePrompt:
      lessonState.currentStage === 'check'
        ? 'Answer the teacher in one or two sentences.'
        : `Ask for help or try one ${stageLabel.toLowerCase()} move now.`,
  };
}
