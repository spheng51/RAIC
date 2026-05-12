import { describe, expect, it } from 'vitest';

import { buildLanguageText } from '@/lib/generation/prompt-formatters';
import {
  DEFAULT_LANGUAGE_DIRECTIVE,
  generateSceneOutlinesFromRequirements,
} from '@/lib/generation/outline-generator';

describe('scene generator language directive', () => {
  it('combines course directive and scene language note', () => {
    expect(buildLanguageText('Teach in Spanish.', 'Use local examples.')).toBe(
      'Teach in Spanish.\n\nAdditional language note for this scene: Use local examples.',
    );
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
    expect(result.data?.languageDirective).toBe(
      'Teach in English with concise classroom language.',
    );
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
    expect(result.data?.languageDirective).toBe(DEFAULT_LANGUAGE_DIRECTIVE);
    expect(result.data?.outlines).toHaveLength(1);
  });
});
