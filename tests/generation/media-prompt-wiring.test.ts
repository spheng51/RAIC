import { describe, expect, it } from 'vitest';

import { buildPrompt, processConditionalBlocks } from '@/lib/generation/prompts';
import { PROMPT_IDS } from '@/lib/generation/prompts';

describe('media prompt wiring', () => {
  it('omits disabled image and video instructions from outline prompts', () => {
    const prompt = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
      requirement: 'Teach photosynthesis',
      language: 'en-US',
      pdfContent: 'None',
      availableImages: 'No images available',
      userProfile: '',
      hasSourceImages: false,
      imageEnabled: false,
      videoEnabled: false,
      mediaEnabled: false,
      researchContext: 'None',
      teacherContext: '',
    });

    expect(prompt?.system).not.toContain('Image generation is available');
    expect(prompt?.system).not.toContain('Video generation is available');
    expect(prompt?.system).not.toContain('Media Safety');
    expect(prompt?.user).not.toContain('Generated media');
  });

  it('includes only the enabled media snippets', () => {
    const prompt = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
      requirement: 'Teach photosynthesis',
      language: 'en-US',
      pdfContent: 'None',
      availableImages: 'No images available',
      userProfile: '',
      hasSourceImages: false,
      imageEnabled: true,
      videoEnabled: false,
      mediaEnabled: true,
      researchContext: 'None',
      teacherContext: '',
    });

    expect(prompt?.system).toContain('AI-Generated Image Requests');
    expect(prompt?.system).toContain('Content Safety Guidelines');
    expect(prompt?.system).not.toContain('Video generation is available');
  });

  it('processes simple conditional blocks before variable interpolation', () => {
    expect(
      processConditionalBlocks('A {{#if enabled}}B {{name}}{{/if}} C', {
        enabled: true,
      }),
    ).toBe('A B {{name}} C');
    expect(
      processConditionalBlocks('A {{#if enabled}}B{{/if}} C', {
        enabled: false,
      }),
    ).toBe('A  C');
  });
});
