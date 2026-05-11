import { describe, expect, it } from 'vitest';

import {
  buildClassroomLessonState,
  buildClassroomTutorSystemPrompt,
  inferLessonStage,
} from '@/lib/classroom/lesson-state';
import type { Scene, Stage } from '@/lib/types/stage';

function buildStage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: 'classroom-1',
    name: 'Newton laws overview',
    createdAt: 0,
    updatedAt: 0,
    language: 'en-US',
    ...overrides,
  };
}

function buildScene(
  id: string,
  order: number,
  title: string,
  type: Scene['type'] = 'slide',
): Scene {
  return {
    id,
    stageId: 'classroom-1',
    type,
    title,
    order,
    content:
      type === 'quiz'
        ? { type: 'quiz', questions: [] }
        : {
            type: 'slide',
            canvas: {
              id: `${id}-slide`,
              viewportSize: 1000,
              viewportRatio: 0.5625,
              elements: [],
            },
          },
  } as Scene;
}

describe('classroom lesson state', () => {
  it('carries Studio launch context into classroom lesson state', () => {
    const state = buildClassroomLessonState({
      stage: buildStage({
        learningGoal: 'Understand Newton second law from a worksheet',
        sourceContext: {
          pdfAttached: true,
          pdfName: 'forces.pdf',
          tavilyEnabled: true,
          language: 'en-US',
          selectedModel: 'openai:gpt-5.1',
        },
      }),
      scenes: [buildScene('intro', 0, 'Introduction'), buildScene('practice', 1, 'Practice lab')],
      currentSceneId: 'practice',
    });

    expect(state.goal).toBe('Understand Newton second law from a worksheet');
    expect(state.currentStage).toBe('practice');
    expect(state.completedStages).toContain('intro');
    expect(state.sourceContext).toMatchObject({
      pdfAttached: true,
      pdfName: 'forces.pdf',
      tavilyEnabled: true,
      language: 'en-US',
      selectedModel: 'openai:gpt-5.1',
    });
  });

  it('uses a graceful fallback when the classroom has no explicit goal', () => {
    const state = buildClassroomLessonState({
      stage: buildStage({ name: '' }),
      scenes: [],
      currentSceneId: null,
      selectedModelFallback: 'anthropic:claude-sonnet-4.5',
    });

    expect(state.goal).toBe('Untitled lesson');
    expect(state.currentStage).toBe('intro');
    expect(state.sourceContext.selectedModel).toBe('anthropic:claude-sonnet-4.5');
  });

  it('infers check-for-understanding from quiz scenes', () => {
    expect(
      inferLessonStage({
        scenes: [
          buildScene('intro', 0, 'Opening'),
          buildScene('quiz', 1, 'Check for understanding', 'quiz'),
        ],
        currentSceneId: 'quiz',
      }),
    ).toBe('check');
  });

  it('builds an adaptive tutor prompt with source boundaries and learner intents', () => {
    const state = buildClassroomLessonState({
      stage: buildStage({
        learningGoal: 'Learn binary search',
        sourceContext: {
          pdfAttached: false,
          tavilyEnabled: false,
          language: 'en-US',
          selectedModel: 'openai:gpt-5.1',
        },
      }),
      scenes: [buildScene('example', 1, 'Worked example')],
      currentSceneId: 'example',
    });

    const prompt = buildClassroomTutorSystemPrompt(state);

    expect(prompt).toContain('Start by briefly confirming the learner');
    expect(prompt).toContain('Ask one short diagnostic question');
    expect(prompt).toContain('"I don\'t get it" means simplify');
    expect(prompt).toContain('No learner PDF is attached');
    expect(prompt).toContain('Web search is disabled');
    expect(prompt).toContain('Use the whiteboard for key terms');
  });
});
