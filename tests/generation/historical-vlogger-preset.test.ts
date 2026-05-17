import { describe, expect, it } from 'vitest';

import { generateSceneActions, generateSceneContent } from '@/lib/generation/scene-generator';
import type { SceneOutline } from '@/lib/types/generation';

const slideOutline: SceneOutline = {
  id: 'scene-1',
  type: 'slide',
  title: 'Arrival at the Harbor',
  description: 'Introduce a source-backed historical moment.',
  keyPoints: ['Verified departure timeline', 'Plausible dockside reconstruction'],
  order: 1,
  language: 'en-US',
  experiencePreset: 'historical-vlogger',
};

describe('historical-vlogger preset scene prompts', () => {
  it('passes preset context into slide content and action prompts from the outline', async () => {
    const contentCalls: Array<{ system: string; user: string }> = [];
    const content = await generateSceneContent(slideOutline, async (system, user) => {
      contentCalls.push({ system, user });
      return JSON.stringify({
        background: { type: 'solid', color: '#ffffff' },
        elements: [
          {
            id: 'title',
            type: 'text',
            left: 60,
            top: 60,
            width: 800,
            height: 70,
            content: '<p style="font-size:32px;"><strong>Arrival at the Harbor</strong></p>',
            defaultFontName: '',
            defaultColor: '#111827',
          },
        ],
      });
    });

    expect(content).not.toBeNull();
    expect(contentCalls[0]?.user).toContain('Historical Vlogger Experience Preset');
    expect(contentCalls[0]?.user).toContain('critical media-literacy');

    const actionCalls: Array<{ system: string; user: string }> = [];
    await generateSceneActions(slideOutline, content!, async (system, user) => {
      actionCalls.push({ system, user });
      return JSON.stringify([{ type: 'text', content: 'Source check before we reconstruct.' }]);
    });

    expect(actionCalls[0]?.user).toContain('Historical Vlogger Experience Preset');
    expect(actionCalls[0]?.user).toContain('AI visual limitations');
  });

  it('passes preset context into quiz content prompts', async () => {
    const quizOutline: SceneOutline = {
      ...slideOutline,
      id: 'quiz-1',
      type: 'quiz',
      title: 'Source Check',
      quizConfig: {
        questionCount: 2,
        difficulty: 'medium',
        questionTypes: ['single'],
      },
    };
    const calls: Array<{ system: string; user: string }> = [];

    const content = await generateSceneContent(quizOutline, async (system, user) => {
      calls.push({ system, user });
      return JSON.stringify([
        {
          id: 'q1',
          type: 'single',
          question: 'Which claim is directly supported by the provided source?',
          options: ['A dated manifest entry', 'An invented eyewitness quote'],
          correctAnswer: 'A dated manifest entry',
        },
      ]);
    });

    expect(content).not.toBeNull();
    expect(calls[0]?.user).toContain('Historical Vlogger Experience Preset');
    expect(calls[0]?.user).toContain('source-literacy question');
  });
});
