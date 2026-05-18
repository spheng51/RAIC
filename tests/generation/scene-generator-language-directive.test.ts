import { describe, expect, it } from 'vitest';

import { buildLanguageText } from '@/lib/generation/prompt-formatters';
import {
  buildCourseLanguageDirective,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';

describe('scene generator language directive', () => {
  it('combines course directive and scene language note', () => {
    expect(buildLanguageText('Teach in Spanish.', 'Use local examples.')).toBe(
      'Teach in Spanish.\n\nAdditional language note for this scene: Use local examples.',
    );
  });

  it('builds deterministic language directives from the selected creation language', () => {
    expect(buildCourseLanguageDirective('en-US')).toContain(
      'All generated classroom content must be written in English.',
    );
    expect(buildCourseLanguageDirective('en-US')).toContain('widget iframe HTML');
    expect(buildCourseLanguageDirective('zh-CN')).toContain(
      'All generated classroom content must be written in Simplified Chinese.',
    );
    expect(buildCourseLanguageDirective('zh-CN')).toContain('lang="zh-CN"');
  });

  it('accepts the new outline response envelope with languageDirective', async () => {
    const result = await generateSceneOutlinesFromRequirements(
      { requirement: 'Teach gravity', language: 'en-US' },
      undefined,
      undefined,
      async () =>
        JSON.stringify({
          languageDirective: 'Teach in English with concise classroom language.',
          outlines: [
            {
              type: 'slide',
              title: 'Gravity',
              description: 'Introduce gravity',
              learningObjective: 'Explain gravity',
            },
          ],
        }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.languageDirective).toBe(buildCourseLanguageDirective('en-US'));
    expect(result.data?.outlines).toHaveLength(1);
  });

  it('keeps legacy bare outline arrays compatible', async () => {
    const result = await generateSceneOutlinesFromRequirements(
      { requirement: 'Teach gravity', language: 'en-US' },
      undefined,
      undefined,
      async () =>
        JSON.stringify([
          {
            type: 'slide',
            title: 'Gravity',
            description: 'Introduce gravity',
            learningObjective: 'Explain gravity',
          },
        ]),
    );

    expect(result.success).toBe(true);
    expect(result.data?.languageDirective).toBe(buildCourseLanguageDirective('en-US'));
    expect(result.data?.outlines).toHaveLength(1);
  });

  it('stamps the historical-vlogger preset onto generated outlines', async () => {
    const result = await generateSceneOutlinesFromRequirements(
      {
        requirement: 'Teach the Titanic sinking through source-backed vlogging',
        language: 'en-US',
        experiencePreset: 'historical-vlogger',
      },
      undefined,
      undefined,
      async () =>
        JSON.stringify({
          languageDirective: 'Teach in English.',
          outlines: [
            {
              type: 'slide',
              title: 'On Deck',
              description: 'Introduce the source-backed scene',
              keyPoints: ['Verified timeline', 'Reconstruction caveat'],
            },
          ],
        }),
    );

    expect(result.success).toBe(true);
    expect(result.data?.outlines[0]?.experiencePreset).toBe('historical-vlogger');
  });
});
