import { describe, expect, it } from 'vitest';

import { buildStructuredPrompt } from '@/lib/orchestration/prompt-builder';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { StatelessChatRequest } from '@/lib/types/chat';
import {
  noAdaptivePromptExpectation,
  repeatedSessionAdaptiveContext,
  repeatedSessionPromptExpectation,
  scorePromptReplay,
} from '../support/adaptive-runtime-replay';

const teacherAgent: AgentConfig = {
  id: 'teacher-1',
  name: 'Lead Teacher',
  role: 'teacher',
  persona: 'Clear, concise, and adaptive.',
  avatar: 'T',
  color: '#1f2937',
  allowedActions: ['wb_open', 'wb_draw_text'],
  priority: 1,
  createdAt: new Date('2026-04-17T00:00:00.000Z'),
  updatedAt: new Date('2026-04-17T00:00:00.000Z'),
  isDefault: true,
};

const storeState = {
  stage: {
    id: 'class-1',
    name: 'Orbital Mechanics',
    createdAt: 0,
    updatedAt: 0,
    language: 'en-US',
  },
  scenes: [],
  currentSceneId: null,
  mode: 'playback',
  whiteboardOpen: false,
} satisfies StatelessChatRequest['storeState'];

describe('buildStructuredPrompt', () => {
  it('includes deterministic adaptive replay markers for repeated-session classrooms', () => {
    const prompt = buildStructuredPrompt(
      teacherAgent,
      storeState,
      undefined,
      undefined,
      undefined,
      undefined,
      repeatedSessionAdaptiveContext,
    );

    expect(scorePromptReplay(prompt, repeatedSessionPromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });

  it('adds the interactive tutor lesson contract to classroom chat prompts', () => {
    const prompt = buildStructuredPrompt(teacherAgent, {
      ...storeState,
      stage: {
        ...storeState.stage,
        learningGoal: 'Use energy conservation to solve a roller-coaster problem',
        sourceContext: {
          pdfAttached: true,
          pdfName: 'energy.pdf',
          tavilyEnabled: false,
          language: 'en-US',
          selectedModel: 'openai:gpt-5.1',
        },
      },
    });

    expect(prompt).toContain('## Interactive Tutor Lesson Contract');
    expect(prompt).toContain(
      'Learning goal: Use energy conservation to solve a roller-coaster problem',
    );
    expect(prompt).toContain('Ask one short diagnostic question');
    expect(prompt).toContain('PDF is available: energy.pdf');
    expect(prompt).toContain('Web search is disabled');
  });

  it.each([
    'teacher first-run classrooms',
    'public demo flows',
    'anonymous flows',
    'student flows',
    'classroom-cookie-only flows',
  ])('omits adaptive enrichment for %s', () => {
    const prompt = buildStructuredPrompt(teacherAgent, storeState);

    expect(scorePromptReplay(prompt, noAdaptivePromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
  });
});
