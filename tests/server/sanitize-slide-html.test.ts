import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { StaticTable } from '@/components/slide-renderer/components/element/TableElement/StaticTable';
import { sanitizeSlideHtml } from '@/lib/utils/sanitize-slide-html';

describe('sanitizeSlideHtml', () => {
  it('preserves safe formatting while removing dangerous markup and styles', () => {
    const sanitized = sanitizeSlideHtml(
      '<p onclick="alert(1)" style="color:#ff0000;font-size:24px;position:fixed">' +
        '<strong>Hi</strong><script>alert(1)</script>' +
        '<span style="text-decoration:underline;background-image:url(javascript:alert(1))">there</span>' +
        '</p>',
    );

    expect(sanitized).toContain('<p style="');
    expect(sanitized).toContain('color:#ff0000');
    expect(sanitized).toContain('font-size:24px');
    expect(sanitized).toContain('<strong>Hi</strong>');
    expect(sanitized).not.toContain('onclick');
    expect(sanitized).not.toContain('<script>');
    expect(sanitized).not.toContain('position:fixed');
    expect(sanitized).not.toContain('background-image');
  });

  it('drops xmp raw-text contents instead of rehydrating executable markup', () => {
    const sanitized = sanitizeSlideHtml(
      '<xmp><img src=x onerror=alert(1)><svg onload=alert(1)></xmp><p>Safe</p>',
    );

    expect(sanitized).toBe('<p>Safe</p>');
    expect(sanitized).not.toContain('<img');
    expect(sanitized).not.toContain('<svg');
    expect(sanitized).not.toContain('onerror');
    expect(sanitized).not.toContain('onload');
  });

  it('renders table cell text as escaped plain text instead of executable HTML', () => {
    const markup = renderToStaticMarkup(
      React.createElement(StaticTable, {
        elementInfo: {
          width: 320,
          data: [
            [
              {
                id: 'cell-1',
                text: '<img src=x onerror=alert(1)>\nline 2',
                colspan: 1,
                rowspan: 1,
                style: {},
              },
            ],
          ],
          colWidths: [1],
          cellMinHeight: 24,
          outline: undefined,
          theme: undefined,
        },
      } as never),
    );

    expect(markup).not.toContain('<img');
    expect(markup).toContain('&lt;img src=x onerror=alert(1)&gt;');
    expect(markup).toContain('line 2');
    expect(markup).toContain('white-space:pre-wrap');
  });
});
