import { describe, expect, it } from 'vitest';

import { buildPrompt, processConditionalBlocks } from '@/lib/generation/prompts';
import { PROMPT_IDS } from '@/lib/generation/prompts';
import {
  noAdaptivePromptExpectation,
  repeatedSessionPromptExpectation,
  scorePromptReplay,
} from '../support/adaptive-runtime-replay';

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

  it('injects adaptive replay markers into outline prompts only when provided', () => {
    const adaptivePrompt =
      '## Adaptive Session Context\n' +
      'Treat this as a repeated-session classroom\n' +
      '- Last completed segment: Orbital transfer maneuvers\n' +
      '- Revisit intent: remediate\n' +
      '- Mastery hints: transfer windows; burn timing\n' +
      '- Reflection summary: Spend more time on transfer windows before moving on.';
    const prompt = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
      requirement: 'Teach orbital mechanics',
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
      adaptivePrompt,
    });
    const firstRunPrompt = buildPrompt(PROMPT_IDS.REQUIREMENTS_TO_OUTLINES, {
      requirement: 'Teach orbital mechanics',
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
      adaptivePrompt: '',
    });

    expect(scorePromptReplay(prompt?.user, repeatedSessionPromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
    expect(scorePromptReplay(firstRunPrompt?.user, noAdaptivePromptExpectation)).toEqual({
      pass: true,
      missing: [],
      unexpected: [],
    });
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
