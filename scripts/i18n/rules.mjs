/**
 * Shared vocabulary for the i18n extraction codemod. The attribute and prop lists and the
 * exclusions mirror docs/localization/tools/census.mjs (that script runs on import, so it cannot
 * be imported here); where this file is narrower the comment says why.
 */
import ts from 'typescript';

export const LETTER = /\p{L}/u;
export const normWs = (s) => s.replace(/\s+/g, ' ').trim();

/** Attributes on any element that people (or assistive technology) read. */
export const A11Y_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'aria-valuetext',
  'title',
  'alt',
  'placeholder',
]);

/**
 * Props on our own components that carry words people read. Census DISPLAY_PROPS minus `name`
 * (often a form field name), `status`, `value` and `prompt` (often machine values), which v1
 * leaves alone.
 */
export const DISPLAY_PROPS = new Set([
  'label',
  'title',
  'heading',
  'description',
  'text',
  'hint',
  'helper',
  'helperText',
  'message',
  'caption',
  'tooltip',
  'eyebrow',
  'subtitle',
  'summary',
  'cta',
  'confirmLabel',
  'cancelLabel',
  'submitLabel',
  'pendingLabel',
  'emptyTitle',
  'emptyBody',
  'body',
  'error',
  'success',
  'notice',
  'legend',
  'headline',
  'lead',
  'badge',
  'actionLabel',
  'ariaLabel',
  'srLabel',
  'detail',
  'note',
  'question',
  'placeholder',
  'kicker',
  'intro',
  'outro',
  'alt',
  'ariaDescription',
  'successMessage',
  'errorMessage',
  'emptyMessage',
  'loadingLabel',
]);
/** Display props whose value is reliably prose even when it is one lower-case word. */
export const HIGH_CONFIDENCE_PROPS = new Set([
  'label',
  'title',
  'heading',
  'headline',
  'description',
  'summary',
  'hint',
  'placeholder',
  'caption',
  'cta',
  'confirmLabel',
  'cancelLabel',
  'tooltip',
  'emptyTitle',
  'emptyBody',
  'helperText',
  'eyebrow',
  'subtitle',
  'legend',
  'kicker',
]);

/** Elements that start a new block: text on either side of them is a separate unit. */
export const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'dd',
  'details',
  'dialog',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'section',
  'summary',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);
/** Children of these are never prose to translate. */
export const RAW_TAGS = new Set(['script', 'style']);
export const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp']);

export const TEST_RE =
  /(\.test\.|\.spec\.|test-support|\.d\.ts$|\/test\/|__tests__|\.test-helpers\.)/;

/** Files whose strings are written for a model, an assistant or a register (census MACHINE_AUDIENCE). */
export const MACHINE_AUDIENCE = [
  [/apps\/web\/src\/app\/mcp\//, 'ai_assistant_tool_text'],
  [/apps\/web\/src\/lib\/mcp/, 'ai_assistant_tool_text'],
  [/apps\/web\/src\/app\/oauth\/(register|revoke|token)\//, 'protocol_json'],
  [
    /apps\/web\/src\/lib\/ccd\/(approved-changes|inventory|parity)[^/]*\.ts$/,
    'internal_design_register',
  ],
  [/(fixture|\.fixtures?\.|sample-data|seed-world)[^/]*\.tsx?$/, 'test_fixture'],
];
export const audienceOfFile = (rel) => {
  for (const [re, a] of MACHINE_AUDIENCE) if (re.test(rel)) return a;
  return null;
};

/** Next.js route files whose default export renders a screen and must prime the locale. */
export const ROUTE_ENTRY_RE =
  /\/(page|layout|template|not-found|global-not-found|default|loading)\.tsx$/;
/** Route files that are not screens of words (images, icons, sitemaps). */
export const SPECIAL_ROUTE_RE =
  /\/(opengraph-image|twitter-image|icon|apple-icon|sitemap|robots|manifest)\.tsx$/;

export const isPascal = (s) => /^[A-Z][A-Za-z0-9_]*$/.test(s);
export const HOOK_RE = /^use[A-Z0-9]/;

// ---------------------------------------------------------------- naming (census compatible)
export function exprName(e) {
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  if (ts.isCallExpression(e)) return `${exprName(e.expression)}()`;
  if (ts.isElementAccessExpression(e)) return `${exprName(e.expression)}[]`;
  if (ts.isNonNullExpression(e) || ts.isParenthesizedExpression(e) || ts.isAsExpression(e))
    return exprName(e.expression);
  if (ts.isConditionalExpression(e)) return 'choice';
  if (ts.isBinaryExpression(e)) return 'value';
  if (ts.isNumericLiteral(e)) return 'n';
  return 'expr';
}
export const cleanName = (n) =>
  n.replace(/\(\)|\[\]/g, '').replace(/[^A-Za-z0-9_]/g, '_') || 'value';

/** lowerCamel from any words: "pilot-banner" -> "pilotBanner". */
export function camel(words) {
  const parts = words
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
    .map((w) => w.replace(/[^A-Za-z0-9]/g, ''))
    .filter(Boolean);
  return parts
    .map((w, i) =>
      i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase(),
    )
    .join('');
}

/** Does a free-standing string look like words a person reads (used only for the report)? */
export function looksLikeText(s) {
  const t = s.trim();
  if (!LETTER.test(t)) return false;
  if (/^(https?:|mailto:|\/|#|\.\.?\/|@)/.test(t)) return false;
  if (/\s/.test(t)) {
    const tokens = t.split(/\s+/);
    // Tailwind-like class lists and code.
    if (tokens.every((tok) => /^[a-z0-9:\-[\]/.%!_()#@&>*+~="']+$/.test(tok))) return false;
    if (/=>|function\s*\(|\bSELECT\b|\bimport\b|\bconst\b|::/.test(t)) return false;
    return true;
  }
  return /^[A-Z][a-z]{2,}[.!?]?$/.test(t);
}
