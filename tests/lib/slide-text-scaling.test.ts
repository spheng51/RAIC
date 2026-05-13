// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { scaleSlideTextHtmlFontSizes } from '@/lib/utils/slide-text-scaling';

describe('scaleSlideTextHtmlFontSizes', () => {
  it('scales nested inline font sizes and preserves other styles', () => {
    const scaled = scaleSlideTextHtmlFontSizes(
      '<p style="font-size:20px;color:#333;text-align:center;">Hello <span style="font-size:10pt;font-weight:700;">class</span></p>',
      1.5,
    );

    expect(scaled).toContain('font-size: 30px');
    expect(scaled).toContain('font-size: 15pt');
    expect(scaled).toContain('color: rgb(51, 51, 51)');
    expect(scaled).toContain('text-align: center');
    expect(scaled).toContain('font-weight: 700');
  });

  it('preserves relative units while scaling font sizes', () => {
    const scaled = scaleSlideTextHtmlFontSizes(
      '<p style="font-size:1.25rem;">A</p><p style="font-size:150%;">B</p><p style="font-size:1.2em;">C</p>',
      2,
    );

    expect(scaled).toContain('font-size: 2.5rem');
    expect(scaled).toContain('font-size: 300%');
    expect(scaled).toContain('font-size: 2.4em');
  });

  it('adds a default font size when older text content has none', () => {
    const scaled = scaleSlideTextHtmlFontSizes('Plain classroom title', 2);

    expect(scaled).toBe('<p style="font-size: 36px;">Plain classroom title</p>');
  });

  it('adds a default font size to existing markup without changing the text', () => {
    const scaled = scaleSlideTextHtmlFontSizes('<strong>Important</strong>', 0.5);

    expect(scaled).toContain('<strong style="font-size: 9px;">Important</strong>');
  });
});
