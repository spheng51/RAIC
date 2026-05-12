import { describe, expect, it } from 'vitest';

import { summarizeScenes } from '@/lib/classroom/complete-summary';
import type { Scene } from '@/lib/types/stage';

const scenes: Scene[] = [
  {
    id: 'slide-1',
    stageId: 'stage-1',
    type: 'slide',
    title: 'Intro',
    order: 0,
    content: { type: 'slide', canvas: {} as never },
  },
  {
    id: 'quiz-1',
    stageId: 'stage-1',
    type: 'quiz',
    title: 'Check',
    order: 1,
    content: {
      type: 'quiz',
      questions: [
        {
          id: 'q1',
          type: 'single',
          question: 'One?',
          answer: ['A'],
        },
        {
          id: 'q2',
          type: 'multiple',
          question: 'Many?',
          answer: ['A', 'C'],
        },
        {
          id: 'q3',
          type: 'short_answer',
          question: 'Explain',
          hasAnswer: false,
        },
      ],
    },
  },
];

describe('complete summary', () => {
  it('counts scene types and grades only locally gradable quiz questions', () => {
    const summary = summarizeScenes(scenes, (sceneId): Record<string, string | string[]> => {
      if (sceneId !== 'quiz-1') return {};
      return { q1: 'A', q2: ['C', 'A'], q3: 'because' };
    });

    expect(summary.countsByType).toEqual({ slide: 1, quiz: 1 });
    expect(summary.quiz).toEqual({ correct: 2, total: 2, pct: 100 });
  });
});
