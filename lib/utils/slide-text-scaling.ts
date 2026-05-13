const DEFAULT_FONT_SIZE_PX = 18;
const MIN_ABSOLUTE_FONT_SIZE = 4;
const MAX_ABSOLUTE_FONT_SIZE = 400;
const MIN_RELATIVE_FONT_SIZE = 0.1;
const MAX_RELATIVE_FONT_SIZE = 1000;
const FONT_SIZE_VALUE_RE = /^\s*([0-9]*\.?[0-9]+)\s*(px|pt|em|rem|%)\s*$/i;
const FONT_SIZE_DECL_RE =
  /(font-size\s*:\s*)([0-9]*\.?[0-9]+)\s*(px|pt|em|rem|%)(\s*!important)?/gi;

function normalizeScaleFactor(scaleFactor: number) {
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return 1;
  return scaleFactor;
}

function formatCssNumber(value: number) {
  return Number(value.toFixed(2)).toString();
}

function scaleCssFontSizeValue(value: string, scaleFactor: number) {
  const match = value.match(FONT_SIZE_VALUE_RE);
  if (!match) return value;

  const [, rawSize, unit] = match;
  const normalizedUnit = unit.toLowerCase();
  const isAbsoluteUnit = normalizedUnit === 'px' || normalizedUnit === 'pt';
  const minSize = isAbsoluteUnit ? MIN_ABSOLUTE_FONT_SIZE : MIN_RELATIVE_FONT_SIZE;
  const maxSize = isAbsoluteUnit ? MAX_ABSOLUTE_FONT_SIZE : MAX_RELATIVE_FONT_SIZE;
  const scaledSize = Math.min(
    maxSize,
    Math.max(minSize, Number(rawSize) * normalizeScaleFactor(scaleFactor)),
  );
  return `${formatCssNumber(scaledSize)}${unit}`;
}

function scaleFontSizesWithRegex(html: string, scaleFactor: number, defaultFontSizePx: number) {
  let scaledCount = 0;
  const scaled = html.replace(
    FONT_SIZE_DECL_RE,
    (_match, prefix: string, rawSize: string, unit: string, important: string = '') => {
      scaledCount += 1;
      const nextValue = scaleCssFontSizeValue(`${rawSize}${unit}`, scaleFactor);
      return `${prefix}${nextValue}${important}`;
    },
  );

  if (scaledCount > 0) return scaled;

  const defaultSize = scaleCssFontSizeValue(`${defaultFontSizePx}px`, scaleFactor);
  return `<p style="font-size: ${defaultSize};">${html}</p>`;
}

export function scaleSlideTextHtmlFontSizes(
  html: string,
  scaleFactor: number,
  defaultFontSizePx = DEFAULT_FONT_SIZE_PX,
) {
  const factor = normalizeScaleFactor(scaleFactor);

  if (typeof DOMParser === 'undefined' || typeof document === 'undefined') {
    return scaleFontSizesWithRegex(html, factor, defaultFontSizePx);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');
  const elements = Array.from(doc.body.querySelectorAll<HTMLElement>('*'));
  let scaledCount = 0;

  for (const element of elements) {
    if (!element.style.fontSize) continue;

    element.style.fontSize = scaleCssFontSizeValue(element.style.fontSize, factor);
    scaledCount += 1;
  }

  if (scaledCount === 0) {
    const defaultSize = scaleCssFontSizeValue(`${defaultFontSizePx}px`, factor);
    const target = doc.body.firstElementChild as HTMLElement | null;

    if (target) {
      target.style.fontSize = defaultSize;
    } else {
      const paragraph = doc.createElement('p');
      paragraph.style.fontSize = defaultSize;
      paragraph.textContent = doc.body.textContent ?? '';
      doc.body.replaceChildren(paragraph);
    }
  }

  return doc.body.innerHTML;
}
