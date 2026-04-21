import { describe, expect, it, vi } from 'vitest';
import {
  getActiveSteps,
  resolveCompletedTeacherServerJob,
  type GenerationSessionState,
} from '@/app/generation-preview/types';

vi.mock('@/lib/store/settings', () => ({
  useSettingsStore: {
    getState: () => ({
      agentMode: 'auto',
    }),
  },
}));

describe('generation preview step selection', () => {
  it('includes the agent-generation step when auto mode is active', () => {
    const session = {
      sessionId: 'session-1',
      requirements: {
        requirement: 'Build a classroom about weather systems.',
        language: 'en-US',
      },
      pdfText: '',
      currentStep: 'generating',
    } as GenerationSessionState;

    const steps = getActiveSteps(session);

    expect(steps.some((step) => step.id === 'agent-generation')).toBe(true);
    expect(steps.some((step) => step.id === 'outline')).toBe(true);
  });

  it('treats partial classroom jobs as navigable and extracts warning messages', () => {
    const result = resolveCompletedTeacherServerJob({
      status: 'succeeded',
      result: {
        id: 'classroom-1',
        url: 'http://localhost:3000/classroom/classroom-1',
        completionStatus: 'partial',
        warnings: [
          { message: 'Scene content generation returned no content' },
          'Media generation failed for gen_img_1',
        ],
      },
    });

    expect(result).toEqual({
      classroomId: 'classroom-1',
      classroomUrl: 'http://localhost:3000/classroom/classroom-1',
      completionStatus: 'partial',
      warnings: [
        'Scene content generation returned no content',
        'Media generation failed for gen_img_1',
      ],
    });
  });
});
