import sanitizeHtml from 'sanitize-html';

const COLOR_PATTERNS = [
  /^#[0-9a-f]{3,8}$/i,
  /^rgb(a)?\(\s*[\d.\s,%+-]+\)$/i,
  /^hsl(a)?\(\s*[\d.\s,%+-]+\)$/i,
  /^[a-z]+$/i,
];

const FONT_FAMILY_PATTERNS = [/^[\w\s,"'-]+$/];
const FONT_SIZE_PATTERNS = [/^\d+(\.\d+)?(px|pt|em|rem|%)$/i];
const FONT_WEIGHT_PATTERNS = [/^(normal|bold|bolder|lighter|[1-9]00)$/i];
const FONT_STYLE_PATTERNS = [/^(normal|italic|oblique)$/i];
const TEXT_ALIGN_PATTERNS = [/^(left|right|center|justify|start|end)$/i];
const TEXT_DECORATION_PATTERNS = [
  /^(none|underline|line-through|overline)(\s+(none|underline|line-through|overline))*$/i,
];
const VERTICAL_ALIGN_PATTERNS = [/^(baseline|sub|super|text-top|text-bottom|middle|top|bottom)$/i];

const ALLOWED_TAGS = [
  'p',
  'br',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'strike',
  'sup',
  'sub',
  'span',
  'ul',
  'ol',
  'li',
] as const;

const ALLOWED_STYLE_TAGS = ['p', 'strong', 'em', 'u', 's', 'sup', 'sub', 'span', 'ul', 'ol', 'li'];

const allowedAttributes = Object.fromEntries(ALLOWED_STYLE_TAGS.map((tag) => [tag, ['style']]));

/**
 * Sanitize rich slide HTML while preserving a narrow formatting subset that
 * matches the app's stored text model.
 */
export function sanitizeSlideHtml(html: string): string {
  if (!html) return '';

  return sanitizeHtml(html, {
    allowedTags: [...ALLOWED_TAGS],
    allowedAttributes,
    allowedStyles: {
      '*': {
        color: COLOR_PATTERNS,
        'background-color': COLOR_PATTERNS,
        'font-family': FONT_FAMILY_PATTERNS,
        'font-size': FONT_SIZE_PATTERNS,
        'font-style': FONT_STYLE_PATTERNS,
        'font-weight': FONT_WEIGHT_PATTERNS,
        'text-align': TEXT_ALIGN_PATTERNS,
        'text-decoration': TEXT_DECORATION_PATTERNS,
        'vertical-align': VERTICAL_ALIGN_PATTERNS,
      },
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    disallowedTagsMode: 'discard',
    nonTextTags: ['script', 'style', 'textarea', 'option', 'noscript', 'xmp'],
    parseStyleAttributes: true,
    transformTags: {
      b: 'strong',
      i: 'em',
      strike: 's',
    },
  });
}
