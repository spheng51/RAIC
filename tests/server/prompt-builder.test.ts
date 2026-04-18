import { describe, expect, it } from 'vitest';

import { buildStructuredPrompt } from '@/lib/orchestration/prompt-builder';
import type { AgentConfig } from '@/lib/orchestration/registry/types';
import type { StatelessChatRequest } from '@/lib/types/chat';
import type { AdaptiveGenerationContext } from '@/lib/types/classroom-intelligence';

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
  it('includes adaptive session guidance when repeated-session context exists', () => {
    const adaptiveContext: AdaptiveGenerationContext = {
      requirementFingerprint: 'class-1',
      priorSessions: 2,
      lastCompletedSceneTitle: 'Orbital transfer maneuvers',
      masteryHints: ['transfer windows', 'burn timing'],
      revisitIntent: 'remediate',
      pacingPreference: 'remediate',
      reflectionSummary: 'Spend more time on transfer windows before moving on.',
      confidenceScore: 2,
    };

    const prompt = buildStructuredPrompt(
      teacherAgent,
      storeState,
      undefined,
      undefined,
      undefined,
      undefined,
      adaptiveContext,
    );

    expect(prompt).toContain('## Adaptive Session Context');
    expect(prompt).toContain('Treat this as a repeated-session classroom');
    expect(prompt).toContain('Last completed segment: Orbital transfer maneuvers');
    expect(prompt).toContain('Mastery hints: transfer windows; burn timing');
    expect(prompt).toContain(
      'Reflection summary: Spend more time on transfer windows before moving on.',
    );
  });

  it('omits adaptive session guidance for first-run flows', () => {
    const prompt = buildStructuredPrompt(teacherAgent, storeState);

    expect(prompt).not.toContain('## Adaptive Session Context');
    expect(prompt).not.toContain('Treat this as a repeated-session classroom');
  });
});
