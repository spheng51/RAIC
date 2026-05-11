import { describe, expect, it } from 'vitest';

import { buildBoardNotes } from '@/lib/classroom/board-notes';
import type { ClassroomLessonState } from '@/lib/classroom/lesson-state';
import type { Scene } from '@/lib/types/stage';

function buildLessonState(overrides: Partial<ClassroomLessonState> = {}): ClassroomLessonState {
  return {
    goal: 'Understand binary search',
    currentStage: 'practice',
    completedStages: ['intro', 'explain', 'example'],
    learnerLevel: 'unknown',
    sourceContext: {
      pdfAttached: false,
      tavilyEnabled: false,
      language: 'en-US',
      selectedModel: 'google:gemini-2.5-flash-lite',
    },
    ...overrides,
  };
}

function buildScene(overrides: Partial<Scene> = {}): Scene {
  return {
    id: 'practice-1',
    stageId: 'classroom-1',
    type: 'slide',
    title: 'Practice with a sorted list',
    order: 2,
    content: {
      type: 'slide',
      canvas: {
        id: 'slide-1',
        viewportSize: 1000,
        viewportRatio: 0.5625,
        elements: [],
      },
    },
    ...overrides,
  } as Scene;
}

describe('classroom board notes', () => {
  it('turns lesson state into compact classroom board notes', () => {
    const notes = buildBoardNotes({
      lessonState: buildLessonState(),
      currentScene: buildScene(),
    });

    expect(notes.keyIdea).toBe('Practice with a sorted list');
    expect(notes.steps).toEqual(['Try a short answer', 'Use a hint if stuck', 'Revise once']);
    expect(notes.practicePrompt).toContain('practice');
  });

  it('falls back to the lesson goal when a scene is missing', () => {
    const notes = buildBoardNotes({
      lessonState: buildLessonState({ currentStage: 'check' }),
      currentScene: null,
    });

    expect(notes.keyIdea).toBe('Understand binary search');
    expect(notes.practicePrompt).toBe('Answer the teacher in one or two sentences.');
  });
});
