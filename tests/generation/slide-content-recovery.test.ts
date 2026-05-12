import { describe, expect, it, vi } from 'vitest';

import { generateSceneContent } from '@/lib/generation/scene-generator';
import type { GeneratedSlideContent, SceneOutline } from '@/lib/types/generation';

const baseOutline: SceneOutline = {
  id: 'water-slide',
  type: 'slide',
  title: 'Welcome to the Water Molecule Lab',
  description: 'Introduce polarity and hydrogen bonding.',
  keyPoints: ['Water is polar', 'Hydrogen bonds shape water behavior'],
  order: 1,
  language: 'en-US',
};

function makeSlideJson(title = 'Recovered Water Molecule Lab'): string {
  return JSON.stringify({
    background: { type: 'solid', color: '#f8fafc' },
    elements: [
      {
        id: 'title_001',
        type: 'text',
        left: 60,
        top: 60,
        width: 880,
        height: 70,
        content: `<p style="font-size:32px;"><strong>${title}</strong></p>`,
        defaultFontName: '',
        defaultColor: '#111827',
      },
    ],
    remark: 'Recovered slide content',
  });
}

function getTextElementContent(content: GeneratedSlideContent, index: number): string {
  const element = content.elements[index];
  expect(element?.type).toBe('text');
  if (!element || element.type !== 'text') {
    throw new Error(`Expected text element at index ${index}`);
  }
  return element.content;
}

describe('slide content recovery', () => {
  it('retries once with a strict JSON prompt when the first slide response is prose', async () => {
    const aiCall = vi
      .fn()
      .mockResolvedValueOnce('Welcome to the Water Molecule Lab')
      .mockResolvedValueOnce(makeSlideJson());

    const content = (await generateSceneContent(baseOutline, aiCall, {
      languageDirective: 'Teach in English.',
    })) as GeneratedSlideContent;

    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(aiCall.mock.calls[1][1]).toContain(
      'Previous response excerpt: Welcome to the Water Molecule Lab',
    );
    expect(aiCall.mock.calls[1][1]).toContain('Return a single valid JSON object only');
    expect(getTextElementContent(content, 0)).toContain('Recovered Water Molecule Lab');
    expect(content.background).toEqual({ type: 'solid', color: '#f8fafc' });
  });

  it('uses a deterministic fallback slide when both slide responses are invalid', async () => {
    const aiCall = vi.fn().mockResolvedValue('Welcome to the Water Molecule Lab');

    const content = (await generateSceneContent(baseOutline, aiCall, {
      languageDirective: 'Teach in English.',
    })) as GeneratedSlideContent;

    expect(aiCall).toHaveBeenCalledTimes(2);
    expect(content.background).toEqual({ type: 'solid', color: '#ffffff' });
    expect(content.elements).toHaveLength(2);
    expect(getTextElementContent(content, 0)).toContain('Welcome to the Water Molecule Lab');
    expect(getTextElementContent(content, 1)).toContain('Water is polar');
    expect(getTextElementContent(content, 1)).toContain('Hydrogen bonds shape water behavior');
  });

  it('escapes fallback slide title and bullet text', async () => {
    const unsafeOutline: SceneOutline = {
      ...baseOutline,
      title: 'Water <Molecule> & "Lab"',
      keyPoints: ['Use <bonds> & angles', "Don't run raw HTML"],
    };
    const aiCall = vi.fn().mockResolvedValue('not json');

    const content = (await generateSceneContent(unsafeOutline, aiCall, {
      languageDirective: 'Teach in English.',
    })) as GeneratedSlideContent;

    expect(getTextElementContent(content, 0)).toContain(
      'Water &lt;Molecule&gt; &amp; &quot;Lab&quot;',
    );
    expect(getTextElementContent(content, 1)).toContain('Use &lt;bonds&gt; &amp; angles');
    expect(getTextElementContent(content, 1)).toContain('Don&#39;t run raw HTML');
  });

  it('keeps valid slide responses on the single-call fast path', async () => {
    const aiCall = vi.fn().mockResolvedValue(makeSlideJson('Valid First Response'));

    const content = (await generateSceneContent(baseOutline, aiCall, {
      languageDirective: 'Teach in English.',
    })) as GeneratedSlideContent;

    expect(aiCall).toHaveBeenCalledTimes(1);
    expect(content.elements).toHaveLength(1);
    expect(getTextElementContent(content, 0)).toContain('Valid First Response');
    expect(content.remark).toBe('Recovered slide content');
  });
});
