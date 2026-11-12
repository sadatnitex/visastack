#!/usr/bin/env node
/**
 * VisaStack user-visible string census (documentation tooling, read-only on the product).
 *
 * Parses every tracked product source file with the TypeScript compiler API, records each string
 * a person can be shown (or may be shown), and writes census.json. Nothing here is executed by
 * the product. Rules are described in docs/localization/VISASTACK_COVERAGE_REPORT.md.
 *
 * Usage: node docs/localization/tools/census.mjs [--out <dir>]
 */
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { hasTag, isMessageKey, splitOnTags, stripMarkers } from './text-markers.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = process.argv.includes('--out')
  ? path.resolve(process.argv[process.argv.indexOf('--out') + 1])
  : path.join(ROOT, 'apps/web/.preview/l10n/work');
fs.mkdirSync(OUT, { recursive: true });

const sh = (c) => execSync(c, { cwd: ROOT, maxBuffer: 1 << 28 }).toString();
const MAIN_SHA = sh('git rev-parse origin/main').trim();

// ---------------------------------------------------------------- scan scope
const _SCAN_GLOBS = [
  'apps/web/src/**/*.ts',
  'apps/web/src/**/*.tsx',
  'packages/services/src/**/*.ts',
  'packages/core/src/**/*.ts',
  'packages/adapters/src/**/*.ts',
  'packages/policy/src/**/*.ts',
  'packages/i18n/src/**/*.ts',
];
const NOT_SCANNED_GLOBS = [
  [
    'packages/db/**',
    'database schema, migrations and seeds: hidden enums and storage names, not screens',
  ],
  ['packages/load/**', 'load-test harness, never shown to people'],
  ['apps/web/e2e/**', 'browser test code'],
  ['apps/web/preview/**', 'preview harness'],
  ['scripts/**', 'repository tooling'],
  ['.github/**', 'continuous-integration workflows'],
];
const TEST_RE = /(\.test\.|\.spec\.|test-support|\.d\.ts$|\/test\/|__tests__|\.test-helpers\.)/;
const SCAN_RE =
  /^(apps\/web\/src\/|packages\/(services|core|adapters|policy|i18n)\/src\/).*\.tsx?$/;
const allFiles = sh('git ls-files')
  .split('\n')
  .filter((f) => SCAN_RE.test(f));
const files = allFiles.filter((f) => !TEST_RE.test(f));
const skippedTests = allFiles.length - files.length;

// ---------------------------------------------------------------- vocab
const A11Y_ATTRS = new Set([
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-placeholder',
  'aria-valuetext',
  'title',
  'alt',
  'placeholder',
]);
// Props on our own components that carry words people read.
const DISPLAY_PROPS = new Set([
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
  'name',
  'detail',
  'note',
  'question',
  'prompt',
  'placeholder',
  'tone-label',
  'status',
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
const STRONG_KEYS = new Set([
  'label',
  'title',
  'heading',
  'headline',
  'description',
  'summary',
  'body',
  'text',
  'hint',
  'placeholder',
  'caption',
  'message',
  'note',
  'detail',
  'why',
  'lead',
  'rationale',
  'problem',
  'next',
  'action',
  'groupLabel',
  'subject',
  'preheader',
  'buttonLabel',
  'cta',
  'confirmLabel',
  'cancelLabel',
  'error',
  'warning',
  'notice',
  'reason',
  'meaning',
  'short',
  'badge',
  'promise',
  'sentence',
  'standing',
  'word',
  'intro',
  'outro',
  'footer',
  'greeting',
  'tooltip',
  'emptyTitle',
  'emptyBody',
  'helperText',
  'successMessage',
  'errorMessage',
  'name',
  'question',
  'instructions',
  'appliesWhen',
  'reference',
  'documentText',
  'claim',
  'value',
  'line',
  'purpose',
  'meta',
  'evidenceThemes',
  'country',
  'matches',
  'slow',
  'failed',
  'invalid',
  'unavailable',
  'removed',
  'error_description',
  'kicker',
  'eyebrow',
  'subtitle',
  'legend',
]);
// How sure we are that a property of this name holds displayed words.
const KEY_CONFIDENCE = {
  HIGH: new Set([
    'label',
    'title',
    'heading',
    'headline',
    'description',
    'summary',
    'hint',
    'placeholder',
    'caption',
    'groupLabel',
    'buttonLabel',
    'cta',
    'confirmLabel',
    'cancelLabel',
    'subject',
    'preheader',
    'tooltip',
    'emptyTitle',
    'emptyBody',
    'helperText',
    'eyebrow',
    'subtitle',
    'legend',
    'kicker',
  ]),
  MEDIUM: new Set([
    'message',
    'text',
    'body',
    'note',
    'error',
    'warning',
    'notice',
    'intro',
    'outro',
    'footer',
    'greeting',
    'successMessage',
    'errorMessage',
    'why',
    'lead',
    'problem',
    'next',
    'action',
    'standing',
    'promise',
    'badge',
    'short',
    'sentence',
    'word',
    'question',
    'instructions',
    'appliesWhen',
    'documentText',
    'claim',
    'detail',
  ]),
};
const confidenceOfKey = (k) =>
  KEY_CONFIDENCE.HIGH.has(k) ? 'HIGH' : KEY_CONFIDENCE.MEDIUM.has(k) ? 'MEDIUM' : 'LOW';

const INLINE_TAGS = new Set([
  'a',
  'strong',
  'em',
  'b',
  'i',
  'span',
  'code',
  'kbd',
  'small',
  'mark',
  'u',
  'abbr',
  'time',
  'sub',
  'sup',
  'Link',
  'bdi',
  'bdo',
  'q',
  'cite',
  'del',
  'ins',
  's',
  'wbr',
  'br',
  'label',
]);
const NON_DISPLAY_ATTRS = new Set([
  'className',
  'class',
  'href',
  'id',
  'name',
  'type',
  'key',
  'ref',
  'src',
  'htmlFor',
  'for',
  'role',
  'style',
  'data-testid',
  'autoComplete',
  'inputMode',
  'method',
  'action',
  'target',
  'rel',
  'value',
  'defaultValue',
  'pattern',
  'accept',
  'lang',
  'dir',
  'tone',
  'variant',
  'size',
  'icon',
  'as',
  'width',
  'height',
  'viewBox',
  'd',
  'fill',
  'stroke',
  'xmlns',
  'sizes',
  'media',
  'content',
  'property',
  'charSet',
  'httpEquiv',
  'crossOrigin',
  'nonce',
]);

// Files whose strings are written for a model or an assistant, never shown on a screen.
const MACHINE_AUDIENCE = [
  [/packages\/services\/src\/ai(-[a-z-]+)?\.ts$/, 'ai_model_prompt'],
  [/packages\/services\/src\/access\/with-ai-connection\.ts$/, 'ai_model_prompt'],
  [/apps\/web\/src\/app\/mcp\//, 'ai_assistant_tool_text'],
  [/packages\/services\/src\/ai-tools\//, 'ai_assistant_tool_text'],
  [/apps\/web\/src\/lib\/mcp/, 'ai_assistant_tool_text'],
  [/apps\/web\/src\/app\/oauth\/(register|revoke|token)\//, 'protocol_json'],
  [/packages\/adapters\/src\/.*(ai|llm|anthropic|openai|model)[^/]*\.ts$/, 'ai_model_prompt'],
];
MACHINE_AUDIENCE.push(
  [/packages\/adapters\/src\/eval\//, 'ai_eval_dataset'],
  [/packages\/adapters\/src\/testing\.ts$/, 'test_double'],
  [
    /apps\/web\/src\/lib\/ccd\/(approved-changes|inventory|parity)[^/]*\.ts$/,
    'internal_design_register',
  ],
  [/(fixture|\.fixtures?\.|sample-data|seed-world)[^/]*\.tsx?$/, 'test_fixture'],
);
const audienceOfFile = (f) => {
  for (const [re, a] of MACHINE_AUDIENCE) if (re.test(f)) return a;
  return null;
};

// ---------------------------------------------------------------- surface / domain / role
function surfaceOf(f) {
  if (/\/app\/.*\/page\.tsx$/.test(f) || /\/app\/page\.tsx$/.test(f)) return 'web_page';
  if (/\/layout\.tsx$|\/template\.tsx$/.test(f)) return 'web_layout';
  if (/\/(error|global-error|not-found|loading)\.tsx$/.test(f)) return 'web_state_screen';
  if (/\/route\.ts$/.test(f)) return 'web_route_handler';
  if (/\/actions\.ts$|-actions\.ts$/.test(f)) return 'web_server_action';
  if (/^apps\/web\/src\/components\//.test(f)) return 'web_component';
  if (/^apps\/web\/src\/lib\//.test(f)) return 'web_lib';
  if (/^apps\/web\/src\/app\//.test(f)) return 'web_app_module';
  if (/^packages\/i18n\//.test(f)) return 'i18n_catalogue';
  if (/^packages\/core\//.test(f)) return 'core_catalogue';
  if (/^packages\/adapters\//.test(f)) return 'adapter';
  if (/^packages\/policy\//.test(f)) return 'policy';
  if (/^packages\/services\//.test(f)) return 'service';
  return 'other';
}
function outputKindOf(f, _kind, prop) {
  if (/email|mail|notification|resend/i.test(f) || ['subject', 'preheader'].includes(prop))
    return 'email_or_notification';
  if (/pdf|invoice|receipt/i.test(f)) return 'pdf_or_billing_document';
  if (/ics|calendar/i.test(f)) return 'calendar_file';
  if (/export|csv|download|archive|snapshot|safe-copy|selected-output/i.test(f))
    return 'download_or_export';
  if (/whatsapp|channel/i.test(f)) return 'chat_message';
  return '';
}
const DOMAIN_RULES = [
  ['consent', /consent/i],
  [
    'auth_account',
    /\/auth\/|sign-?in|sign-?up|password|reauth|verify-email|account-recovery|neon-auth|session/i,
  ],
  ['payments_billing', /billing|invoice|receipt|payment|plan|entitle|refund|price|pricing/i],
  ['sharing_grants', /sharing|grant|shared|invitation|invite|contributor|access-ends|revok/i],
  ['agency_collection', /collect|guest|request/i],
  ['agency', /agency|org(anization)?s?\/|team|client/i],
  [
    'documents_vault',
    /document|wallet|upload|scan|safe-copy|redaction|photo|vault|file|import|output|snapshot/i,
  ],
  ['case_readiness', /mission|case|readiness|checklist|pack|requirement|snapshot|appointment/i],
  ['profile_record', /profile|applicant|record|memory|evidence|expiry|history|removal|identity/i],
  [
    'privacy_lifecycle',
    /privacy|retention|erasure|deletion|delete|export|legal-?hold|lifecycle|hold/i,
  ],
  ['trips_countries', /trip|countr|destination|route|visa/i],
  ['admin_platform', /\/admin\/|staff|platform|audit|moderation|complaint/i],
  ['notifications', /notification|reminder|digest|attention/i],
  ['public_marketing', /^apps\/web\/src\/app\/(page|status|trust|terms|privacy|help)/i],
  ['navigation_chrome', /nav|header|footer|sidebar|banner|breadcrumb|skip/i],
  ['ai_suggestions', /\bai\b|suggest|extract|reading/i],
];
function domainOf(f, text = '') {
  for (const [d, re] of DOMAIN_RULES) if (re.test(f)) return d;
  for (const [d, re] of DOMAIN_RULES) if (re.test(text)) return d;
  return 'general';
}

function routeInfo(file) {
  // folder path under src/app -> route
  const m = file.match(/^apps\/web\/src\/app\/(.*)$/);
  if (!m) return null;
  const parts = m[1].split('/');
  parts.pop();
  const clean = parts.filter((p) => !/^\(.*\)$/.test(p));
  return `/${clean.join('/')}`;
}
// ---------------------------------------------------------------- text helpers
const LETTER = /\p{L}/u;
const normWs = (s) => s.replace(/\s+/g, ' ').trim();
const hash = (s, n = 10) => createHash('sha1').update(s).digest('hex').slice(0, n);
function exprName(e) {
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
const cleanName = (n) => n.replace(/\(\)|\[\]/g, '').replace(/[^A-Za-z0-9_]/g, '_') || 'value';
const NUMERIC_NAME =
  /^(count|n|total|num|number|days?|hours?|minutes?|mins?|seconds?|size|limit|max|min|length|remaining|left|pages?|items?|files?|documents?|requirements?|members?|seats?|attempts?|amount|age|years?|months?|weeks?)$/i;

/** Template/string/concatenation -> { text, placeholders[], dynamicOnly } or null. */
function stringParts(node, src) {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))
    return { text: node.text, ph: [], plural: false };
  if (ts.isTemplateExpression(node)) {
    let text = node.head.text;
    const ph = [];
    let plural = false;
    for (const span of node.templateSpans) {
      const ex = span.expression;
      // `${n === 1 ? '' : 's'}` and friends are English-only plural endings.
      if (
        ts.isConditionalExpression(ex) &&
        ts.isStringLiteralLike(ex.whenTrue) &&
        ts.isStringLiteralLike(ex.whenFalse) &&
        /^(|s|es)$/.test(ex.whenTrue.text) &&
        /^(|s|es)$/.test(ex.whenFalse.text) &&
        ex.whenTrue.text !== ex.whenFalse.text
      ) {
        text += '(s)';
        plural = true;
      } else {
        const nm = cleanName(exprName(ex));
        ph.push(nm);
        text += `{${nm}}`;
      }
      text += span.literal.text;
    }
    return { text, ph, plural };
  }
  if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    const l = stringParts(node.left, src) ?? {
      text: `{${cleanName(exprName(node.left))}}`,
      ph: [cleanName(exprName(node.left))],
      plural: false,
    };
    const r = stringParts(node.right, src) ?? {
      text: `{${cleanName(exprName(node.right))}}`,
      ph: [cleanName(exprName(node.right))],
      plural: false,
    };
    if (
      !(
        ts.isStringLiteralLike(node.left) ||
        ts.isTemplateExpression(node.left) ||
        ts.isStringLiteralLike(node.right) ||
        ts.isTemplateExpression(node.right) ||
        ts.isBinaryExpression(node.left)
      )
    )
      return null;
    return {
      text: l.text + r.text,
      ph: [...l.ph, ...r.ph],
      plural: l.plural || r.plural,
      concat: true,
    };
  }
  return null;
}

/** Expand an expression to the strings it can produce (branches of ?: && || ??) plus dynamic leftovers. */
function resolveValue(node, src, out = { strings: [], dyn: [] }, branch = '') {
  const n = node;
  if (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression?.(n) ||
    ts.isTypeAssertionExpression?.(n)
  )
    return resolveValue(n.expression, src, out, branch);
  if (ts.isConditionalExpression(n)) {
    resolveValue(n.whenTrue, src, out, `${branch}?T`);
    resolveValue(n.whenFalse, src, out, `${branch}?F`);
    return out;
  }
  if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken)
      return resolveValue(n.right, src, out, `${branch}&&`);
    if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) {
      resolveValue(n.left, src, out, `${branch}||L`);
      resolveValue(n.right, src, out, `${branch}||R`);
      return out;
    }
    if (k === ts.SyntaxKind.PlusToken) {
      const p = stringParts(n, src);
      if (p) {
        out.strings.push({ ...p, branch });
        return out;
      }
    }
    return out;
  }
  const p = stringParts(n, src);
  if (p) {
    out.strings.push({ ...p, branch });
    return out;
  }
  if (
    ts.isIdentifier(n) ||
    ts.isPropertyAccessExpression(n) ||
    ts.isElementAccessExpression(n) ||
    ts.isCallExpression(n)
  ) {
    out.dyn.push({
      expr: normWs(n.getText(src)).slice(0, 160),
      name: exprName(n),
      call: ts.isCallExpression(n),
      branch,
    });
    return out;
  }
  return out;
}

// ---------------------------------------------------------------- the walk
const rows = [];
const dynamicRows = [];
const excluded = {};
const countExcluded = (reason) => {
  excluded[reason] = (excluded[reason] ?? 0) + 1;
};
const fileStats = {};

function enclosingOf(node) {
  const stack = [];
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isFunctionDeclaration(p) && p.name) stack.push(p.name.text);
    else if (ts.isMethodDeclaration(p) && p.name) stack.push(p.name.getText());
    else if (ts.isClassDeclaration(p) && p.name) stack.push(p.name.text);
    else if ((ts.isArrowFunction(p) || ts.isFunctionExpression(p)) && p.parent) {
      if (ts.isVariableDeclaration(p.parent) && ts.isIdentifier(p.parent.name))
        stack.push(p.parent.name.text);
      else if (ts.isPropertyAssignment(p.parent)) stack.push(p.parent.name.getText());
    } else if (
      ts.isVariableDeclaration(p) &&
      ts.isIdentifier(p.name) &&
      !p.parent?.parent?.parent?.kind
    )
      stack.push(p.name.text);
    else if (
      ts.isVariableDeclaration(p) &&
      ts.isIdentifier(p.name) &&
      ts.isSourceFile(p.parent?.parent?.parent)
    )
      stack.push(p.name.text);
  }
  return stack.length ? stack.slice(0, 2).reverse().join('>') : '<module>';
}
function jsxPathOf(node) {
  const tags = [];
  for (let p = node.parent; p && tags.length < 3; p = p.parent) {
    if (ts.isJsxElement(p)) tags.push(p.openingElement.tagName.getText());
    else if (ts.isJsxSelfClosingElement(p)) tags.push(p.tagName.getText());
  }
  return tags.reverse().join('>');
}

const STATE_PATTERNS = [
  [
    'empty',
    /\b(no|nothing|not any)\b.*\byet\b|\bempty\b|nothing here|haven't (added|started)|no .{1,40} (to show|found)\b/i,
  ],
  [
    'loading',
    /\b(loading|please wait|one moment|checking|working on it|uploading|saving\.\.\.|\.\.\.)\b|…/i,
  ],
  [
    'success',
    /\b(saved|sent|done|complete[d]?|thank you|all set|success|added|removed|updated|copied|accepted)\b/i,
  ],
  [
    'error',
    /\b(error|couldn'?t|could not|can'?t|cannot|failed|something went wrong|try again|not work|unable|isn'?t working)\b/i,
  ],
  [
    'validation',
    /\b(required|invalid|must be|too (long|short|large|small)|please (enter|choose|select|check)|not valid|doesn'?t look right|at least|at most)\b/i,
  ],
  ['expired', /\b(expired|expires|expiry|expiring|no longer valid|out of date|overdue)\b/i],
  [
    'permission_denied',
    /\b(not allowed|no access|not have access|permission|forbidden|denied|only the owner|can'?t open|don'?t have)\b/i,
  ],
  ['revoked_ended', /\b(revoked|ended|withdrawn|cancel(l)?ed|closed|stopped)\b/i],
  ['pending', /\b(pending|waiting|awaiting|in progress|not yet|still needed|processing)\b/i],
  ['offline', /\b(offline|no connection|connection (was )?lost|network)\b/i],
  ['rejected', /\b(rejected|declined|refused|held for safety|flagged)\b/i],
];
function stateHints(text, encl, file, _node) {
  const hints = new Set();
  const base = path.basename(file);
  if (/^error\.tsx$|^global-error\.tsx$/.test(base)) hints.add('error_boundary');
  if (/^not-found\.tsx$/.test(base)) hints.add('not_found');
  if (/^loading\.tsx$/.test(base)) hints.add('loading');
  for (const [name, re] of STATE_PATTERNS) if (re.test(text)) hints.add(name);
  const e = encl.toLowerCase();
  for (const k of [
    'empty',
    'loading',
    'error',
    'expired',
    'denied',
    'revoked',
    'offline',
    'success',
    'rejected',
    'pending',
    'readonly',
    'locked',
  ])
    if (e.includes(k)) hints.add(`fn:${k}`);
  return [...hints].join('|');
}

// Guardrail vocabulary tags (see VISASTACK_SEMANTIC_GUARDRAILS.md).
const GUARD_TAGS = [
  [
    'G1_state_word',
    /\b(saved|submitted|sent|received|reviewed|accepted|verified|approved|confirmed|ready)\b/i,
  ],
  [
    'G2_safety_check',
    /\b(antivirus|malware|viruses|virus|scanned|scanning|scan|format checked|held for safety|quarantine|quarantined|safe to open|file check)\b/i,
  ],
  [
    'G3_requirement_level',
    /\b(mandatory|required|optional|recommended|one of|any of|unknown|not applicable|n\/a|if applicable|depending)\b/i,
  ],
  [
    'G4_who_is_asking',
    /\b(request(ed)? by|agency request|grant|visa application|government|embassy|consulate|authority|file with|submitted to)\b/i,
  ],
  [
    'G5_share_lifecycle',
    /\b(invitation|invite|link|accept(ed)?|revok|expire|expir|download(ed)? cop|retain|already (downloaded|saved)|access (ends|ended))\b/i,
  ],
  [
    'G6_copy_version',
    /\b(current copy|earlier|superseded|replaced|exact (copy|version)|pinned|version|newer|older|previous)\b/i,
  ],
  [
    'G7_country_role',
    /\b(nationality|citizen|residence|resident|destination|where you (live|apply)|apply from|place of application|consular|applying (in|from))\b/i,
  ],
  [
    'G8_data_action',
    /\b(export|share|sharing|original|safe copy|archive|delete|deletion|erase|erasure|permanent|legal hold|remove|removal)\b/i,
  ],
  [
    'G9_claim_strength',
    /\b(guarantee|secure|encrypt|safe|certified|official|verified source|approved by|compliant|100%|always|never|instantly|accurate)\b/i,
  ],
];
const guardTags = (t) =>
  GUARD_TAGS.filter(([, re]) => re.test(t))
    .map(([n]) => n)
    .join('|');

function pluralNeed(text, ph, plural) {
  const flags = [];
  if (plural) flags.push('ENGLISH_PLURAL_SUFFIX_HACK');
  if (/\(s\)|\(es\)/.test(text)) flags.push('PLURAL_PAREN_S');
  if (ph.some((p) => NUMERIC_NAME.test(p))) flags.push('ICU_PLURAL_OR_NUMBER');
  if (/\b(1st|2nd|3rd|\dth)\b/.test(text)) flags.push('ORDINAL');
  if (ph.length > 1) flags.push('MULTI_PLACEHOLDER_ORDER');
  if (/\byou(r)?\b/i.test(text)) flags.push('SECOND_PERSON_FORMALITY');
  if (/\b(he|she|his|her|him)\b/i.test(text)) flags.push('GENDERED_PRONOUN');
  return flags.join('|');
}

function looksLikeSentence(t) {
  const s = t.trim();
  if (s.length < 8) return false;
  if (!/\s/.test(s)) return false;
  if (!/^[\p{Lu}ঀ-৿"'“(]/u.test(s)) return false;
  if (
    /=>|function\s*\(|SELECT |INSERT |import |require\(|\bconst\b|\blet\b|\{\s*"|^https?:|^\/|\.\w{2,4}$/.test(
      s,
    )
  )
    return false;
  const letters = (s.match(/\p{L}/gu) || []).length;
  return letters / s.length > 0.55;
}
const TW_LIKE = (t) =>
  t.split(/\s+/).every((tok) => /^[a-z0-9:\-[\]/.%!_()#@&>*+~="']+$/.test(tok));

function pushRow(r) {
  rows.push(r);
}

function processFile(rel) {
  const abs = path.join(ROOT, rel);
  const code = fs.readFileSync(abs, 'utf8');
  const kind = rel.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(rel, code, ts.ScriptTarget.Latest, true, kind);
  const surface = surfaceOf(rel);
  const audience = audienceOfFile(rel);
  const route = routeInfo(rel);
  const ordinals = new Map();
  const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + 1;
  const stat = { rows: 0, dynamic: 0 };
  fileStats[rel] = stat;

  function emit(node, partial) {
    const text = normWs(partial.text ?? '');
    if (!text || !LETTER.test(text)) return;
    // Values that look like words but are data: IANA time-zone ids, SQL fragments, file names used as source references.
    if (
      /^[A-Z][A-Za-z_]+\/[A-Za-z_/+-]+$/.test(text) ||
      /::\w+|\btimestamptz\b|\bSELECT\b|\bWHERE\b/.test(text)
    )
      return;
    if (/^system: /.test(text)) return;
    if (partial.prop === 'reference' && /\.(pdf|jpe?g|png|docx?|xlsx?)$/i.test(text)) return;
    // Markup inside a string (an email body, an offline page): each text run is its own unit.
    if (partial.kind !== 'jsx_composed' && !partial.splitDone && hasTag(text)) {
      const runs = splitOnTags(text)
        .map(normWs)
        .filter((x) => x && LETTER.test(x));
      let first;
      for (const run of runs) {
        const ph = [...run.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        const r = emit(node, {
          ...partial,
          kind: `html_run:${partial.kind}`,
          text: run,
          ph,
          splitDone: true,
        });
        first = first ?? r;
      }
      return first;
    }
    const encl = enclosingOf(node);
    const start = lineOf(node.getStart(sf));
    const end = lineOf(node.getEnd());
    const tuple = [rel, encl, partial.kind, partial.prop ?? '', text].join('|');
    const ord = (ordinals.get(tuple) ?? 0) + 1;
    ordinals.set(tuple, ord);
    const ph = partial.ph ?? [];
    const row = {
      id: `SRC-${hash(tuple)}${ord > 1 ? `-${ord}` : ''}`,
      file: rel,
      line_start: start,
      line_end: end,
      surface,
      component: encl,
      jsx_path: partial.jsxPath ?? '',
      kind: partial.kind,
      prop_or_attr: partial.prop ?? '',
      evidence: audience
        ? `EXCLUDED_${audience.toUpperCase()}`
        : /starter-checklists\/seed-rows/.test(rel) &&
            ['purpose', 'country', 'reference'].includes(partial.prop ?? '')
          ? 'EXCLUDED_MATCHING_KEY'
          : isMessageKey(text)
            ? 'EXCLUDED_MATCHING_KEY'
            : partial.evidence,
      confidence: partial.confidence ?? '',
      english: text,
      placeholders: ph.join(','),
      icu_flags: pluralNeed(text, ph, partial.plural),
      branch: partial.branch ?? '',
      key: partial.key ?? '',
      route_own: route ?? '',
      output_kind: outputKindOf(rel, partial.kind, partial.prop ?? ''),
      state_hint: stateHints(text, encl, rel, node),
      guard_tags: guardTags(text),
      composed_in: partial.composedIn ?? '',
      audience: audience ?? 'person',
      domain: domainOf(rel, text),
    };
    stat.rows++;
    pushRow(row);
    return row;
  }
  function emitDynamic(node, d, kind, prop, jsxPath) {
    const encl = enclosingOf(node);
    const tuple = [rel, encl, 'dyn', kind, d.expr].join('|');
    const ord = (ordinals.get(tuple) ?? 0) + 1;
    ordinals.set(tuple, ord);
    stat.dynamic++;
    dynamicRows.push({
      id: `DYN-${hash(tuple)}${ord > 1 ? `-${ord}` : ''}`,
      file: rel,
      line_start: lineOf(node.getStart(sf)),
      line_end: lineOf(node.getEnd()),
      surface,
      component: encl,
      jsx_path: jsxPath ?? '',
      kind,
      prop_or_attr: prop ?? '',
      expr: d.expr,
      name: d.name,
      is_call: d.call,
      branch: d.branch,
      route_own: route ?? '',
      audience: audience ?? 'person',
      domain: domainOf(rel, d.expr),
    });
  }

  // ---- i18n catalogue: record exact keys and BN counterparts
  if (rel === 'packages/i18n/src/messages.ts') {
    sf.forEachChild(function top(n) {
      if (ts.isVariableStatement(n)) {
        for (const d of n.declarationList.declarations) {
          if (ts.isIdentifier(d.name) && ['EN', 'BN'].includes(d.name.text) && d.initializer) {
            const obj =
              ts.isSatisfiesExpression?.(d.initializer) || ts.isAsExpression(d.initializer)
                ? d.initializer.expression
                : d.initializer;
            if (ts.isObjectLiteralExpression(obj)) {
              for (const p of obj.properties) {
                if (ts.isPropertyAssignment(p)) {
                  const k = p.name.getText().replace(/^['"]|['"]$/g, '');
                  const parts = stringParts(p.initializer, sf);
                  if (parts)
                    emit(p, {
                      kind: `catalogue_${d.name.text.toLowerCase()}`,
                      evidence: 'CATALOGUE',
                      confidence: 'HIGH',
                      key: k,
                      text: parts.text,
                      ph: [...parts.text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]),
                      prop: k,
                    });
                }
              }
            }
          }
        }
      }
    });
    return;
  }

  // mixed-content composition (translation units for sentences split by markup)
  function composeChildren(children, depth = 0) {
    let text = '';
    let hasLetterText = false;
    let hasOther = false;
    const frags = [];
    for (const c of children) {
      if (ts.isJsxText(c)) {
        const t = c.text.replace(/\s+/g, ' ');
        if (LETTER.test(t)) hasLetterText = true;
        text += t;
        frags.push(c);
      } else if (ts.isJsxExpression(c)) {
        if (!c.expression) continue;
        const r = resolveValue(c.expression, sf);
        if (r.strings.length === 1 && r.dyn.length === 0 && !r.strings[0].branch)
          text += r.strings[0].text;
        else {
          hasOther = true;
          text += `{${cleanName(exprName(c.expression))}}`;
        }
      } else if (ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c)) {
        const tag = ts.isJsxElement(c) ? c.openingElement.tagName.getText() : c.tagName.getText();
        const inline = INLINE_TAGS.has(tag);
        if (ts.isJsxSelfClosingElement(c)) {
          hasOther = true;
          text += tag === 'br' ? ' ' : `<${tag}/>`;
        } else if (inline && depth < 3) {
          const inner = composeChildren(c.children, depth + 1);
          hasOther = true;
          text += `<${tag}>${inner.text}</${tag}>`;
          if (inner.hasLetterText) hasLetterText = true;
        } else {
          hasOther = true;
          text += `<${tag}/>`;
        }
      } else if (ts.isJsxFragment(c)) {
        const inner = composeChildren(c.children, depth + 1);
        text += inner.text;
        if (inner.hasLetterText) hasLetterText = true;
        hasOther = true;
      }
    }
    return { text, hasLetterText, hasOther, frags };
  }

  const composedFor = new Map(); // JsxText node -> composed row id

  function visit(node) {
    // --- JSX mixed-content composition
    if ((ts.isJsxElement(node) || ts.isJsxFragment(node)) && node.children.length) {
      const hasText = node.children.some((c) => ts.isJsxText(c) && LETTER.test(c.text));
      const hasOther = node.children.some((c) => !ts.isJsxText(c));
      const tag = ts.isJsxElement(node) ? node.openingElement.tagName.getText() : '';
      if (hasText && hasOther && !/^(script|style)$/.test(tag)) {
        const c = composeChildren(node.children);
        const flat = normWs(c.text);
        // only worth a unit when markup or an expression sits inside the sentence
        const textOnlyFragments = node.children.filter(
          (x) => ts.isJsxText(x) && LETTER.test(x.text),
        ).length;
        if (
          c.hasLetterText &&
          stripMarkers(flat)
            .replace(/\{\w+\}/g, '')
            .trim().length > 0 &&
          (c.hasOther || textOnlyFragments > 1)
        ) {
          const ph = [...flat.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
          const row = emit(node, {
            kind: 'jsx_composed',
            evidence: 'SYNTAX_JSX_COMPOSED',
            confidence: 'HIGH',
            text: flat,
            ph,
            jsxPath: jsxPathOf(node),
          });
          if (row) for (const f of c.frags) composedFor.set(f, row.id);
        }
      }
    }
    // --- JSX text
    if (ts.isJsxText(node)) {
      const t = normWs(node.text);
      if (t && LETTER.test(t)) {
        const par = node.parent;
        const tag = ts.isJsxElement(par) ? par.openingElement.tagName.getText() : '';
        if (!/^(script|style)$/.test(tag))
          emit(node, {
            kind: 'jsx_text',
            evidence: 'SYNTAX_JSX',
            confidence: 'HIGH',
            text: t,
            jsxPath: jsxPathOf(node),
            composedIn: composedFor.get(node) ?? '',
          });
      }
    }
    // --- JSX attributes
    if (ts.isJsxAttribute(node) && node.initializer) {
      const name = node.name.getText();
      const opening = node.parent.parent;
      const tag = opening.tagName.getText();
      const custom = /^[A-Z]/.test(tag) || tag.includes('.');
      const isA11y =
        A11Y_ATTRS.has(name) ||
        (!custom && name === 'label' && /^(option|optgroup|track)$/.test(tag)) ||
        (!custom &&
          name === 'value' &&
          tag === 'input' &&
          opening.attributes.properties.some(
            (p) =>
              ts.isJsxAttribute(p) &&
              p.name.getText() === 'type' &&
              p.initializer &&
              /submit|button|reset/.test(p.initializer.getText()),
          ));
      const isListedProp = custom && DISPLAY_PROPS.has(name);
      // Any other string prop on our own components that reads like words (why="...", term="...").
      let isOtherProp = false;
      if (
        custom &&
        !isListedProp &&
        !isA11y &&
        !NON_DISPLAY_ATTRS.has(name) &&
        !/^(on[A-Z]|data-|aria-)/.test(name)
      ) {
        const initExpr = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (initExpr) {
          const probe = resolveValue(initExpr, sf);
          isOtherProp = probe.strings.some(
            (st) =>
              /\s/.test(st.text.trim()) ||
              (/(label|title|text|heading|caption|hint|message|placeholder|description|summary)$/i.test(
                name,
              ) &&
                /^[A-Z\u0980-\u09FF]/.test(st.text.trim())),
          );
        }
      }
      const isProp = isListedProp || isOtherProp;
      if (isA11y || isProp) {
        const init = ts.isJsxExpression(node.initializer)
          ? node.initializer.expression
          : node.initializer;
        if (init) {
          const r = resolveValue(init, sf);
          if (!isA11y && !KEY_CONFIDENCE.HIGH.has(name))
            r.strings = r.strings.filter((st) => !/^[a-z0-9_.-]+$/.test(st.text.trim()));
          for (const s of r.strings)
            emit(node, {
              kind: isA11y ? 'jsx_attr_accessible' : 'jsx_prop_display',
              prop: `${tag}.${name}`,
              evidence: isA11y ? 'SYNTAX_ATTR' : 'PROP_JSX',
              confidence: isA11y ? 'HIGH' : name === 'name' || isOtherProp ? 'LOW' : 'MEDIUM',
              text: s.text,
              ph: s.ph,
              plural: s.plural,
              branch: s.branch,
              jsxPath: jsxPathOf(node),
            });
          for (const d of r.dyn)
            emitDynamic(
              node,
              d,
              isA11y ? 'dynamic_attr_accessible' : 'dynamic_prop_display',
              `${tag}.${name}`,
              jsxPathOf(node),
            );
        }
      }
      return ts.forEachChild(node, visit);
    }
    // --- JSX expression children
    if (
      ts.isJsxExpression(node) &&
      (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) &&
      node.expression
    ) {
      const ex = node.expression;
      const r = resolveValue(ex, sf);
      const par = node.parent;
      const ptag = ts.isJsxElement(par) ? par.openingElement.tagName.getText() : '';
      if (!/^(script|style)$/.test(ptag)) {
        for (const s of r.strings)
          emit(node, {
            kind: 'jsx_expr_literal',
            evidence: 'SYNTAX_JSX_EXPR',
            confidence: 'HIGH',
            text: s.text,
            ph: s.ph,
            plural: s.plural,
            branch: s.branch,
            jsxPath: jsxPathOf(node),
          });
        for (const d of r.dyn) {
          if (d.name === 'children') continue;
          emitDynamic(
            node,
            d,
            d.call ? 'dynamic_call_in_jsx' : 'dynamic_ref_in_jsx',
            '',
            jsxPathOf(node),
          );
        }
      }
    }
    // --- object properties with display-bearing names
    if (
      ts.isPropertyAssignment(node) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      const key = ts.isIdentifier(node.name) ? node.name.text : node.name.text;
      const parent = node.parent;
      // enum-keyed label maps: { PENDING: 'Waiting', ... }
      const isEnumKey =
        /^[A-Z][A-Z0-9_]{2,}$/.test(key) ||
        /^[a-z]+(_[a-z]+)+$/.test(key) ||
        /^[a-z][\w-]*(\.[\w-]+)+$/.test(key) ||
        /^[a-z]+(-[a-z]+)+$/.test(key);
      const inMap = isEnumKey && ts.isObjectLiteralExpression(parent);
      if (STRONG_KEYS.has(key) || inMap) {
        const r = resolveValue(node.initializer, sf);
        const vkind = inMap && !STRONG_KEYS.has(key) ? 'label_map_value' : 'property_text';
        for (const s of r.strings) {
          if (vkind === 'label_map_value' && !(/\s/.test(s.text) || /^[A-Z][a-z]/.test(s.text)))
            continue;
          if (
            vkind === 'property_text' &&
            !(
              /\s/.test(s.text) ||
              s.text.length > 12 ||
              /^[A-Z]/.test(s.text) ||
              (confidenceOfKey(key) !== 'LOW' &&
                !['value', 'name', 'reference', 'country', 'matches', 'line', 'meta'].includes(
                  key,
                ) &&
                /^[a-z][a-z' -]{2,}$/.test(s.text))
            )
          )
            continue;
          if (vkind === 'property_text' && TW_LIKE(s.text) && !/^[A-Z]/.test(s.text)) continue;
          emit(node, {
            kind: vkind,
            prop: key,
            evidence: 'PROPERTY_HEURISTIC',
            confidence: vkind === 'label_map_value' ? 'MEDIUM' : confidenceOfKey(key),
            text: s.text,
            ph: s.ph,
            plural: s.plural,
            branch: s.branch,
            key,
          });
        }
        for (const d of r.dyn) emitDynamic(node, d, 'dynamic_property_text', key);
      }
    }
    // --- named constants, label maps and lists of words
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const nm = node.name.text;
      const COPYISH =
        /(LABEL|COPY|TEXT|WORD|TITLE|HEADING|HEADLINE|MESSAGE|CAPTION|HINT|NOTE|PHRASE|STATUS|TERM|REASON|TONE|BADGE|OPTION|CHOICE|STEP|TAB|MENU|NAV|ZONE|CITY|NAME|PROMISE|SLOGAN|INTRO|ERROR|NOTICE|BANNER|TOOLTIP)/i;
      let init = node.initializer;
      while (
        ts.isAsExpression(init) ||
        ts.isParenthesizedExpression(init) ||
        ts.isSatisfiesExpression?.(init)
      )
        init = init.expression;
      const looksText = (t) =>
        (/\s/.test(t) || /^[A-Z]/.test(t) || /[.!?:]$/.test(t)) &&
        !/^[\w.:/#-]+$/.test(t.replace(/\s/g, '')) === false
          ? true
          : /\s/.test(t) || /^[A-Z][a-z]/.test(t);
      if (
        (ts.isStringLiteralLike(init) || ts.isTemplateExpression(init)) &&
        (/^[A-Z][A-Z0-9_]{2,}$/.test(nm) || COPYISH.test(nm))
      ) {
        const ps = stringParts(init, sf);
        if (ps && LETTER.test(ps.text) && looksText(ps.text) && !/^[a-z0-9_.:/-]+$/.test(ps.text))
          emit(node, {
            kind: 'named_const_text',
            prop: nm,
            evidence: 'PROPERTY_HEURISTIC',
            confidence: 'MEDIUM',
            text: ps.text,
            ph: ps.ph,
            plural: ps.plural,
            key: nm,
          });
      } else if (ts.isObjectLiteralExpression(init) && COPYISH.test(nm)) {
        const walkObj = (o, pathName) => {
          for (const pr of o.properties) {
            if (!ts.isPropertyAssignment(pr)) continue;
            const kn = pr.name.getText().replace(/^['"]|['"]$/g, '');
            let v = pr.initializer;
            while (ts.isAsExpression(v) || ts.isParenthesizedExpression(v)) v = v.expression;
            if (ts.isObjectLiteralExpression(v)) {
              if (pathName.split('.').length < 3) walkObj(v, `${pathName}.${kn}`);
              continue;
            }
            const r = resolveValue(v, sf);
            for (const st of r.strings)
              if (LETTER.test(st.text) && !/^[a-z0-9_.:/-]+$/.test(st.text))
                emit(pr, {
                  kind: 'label_map_value',
                  prop: `${pathName}.${kn}`,
                  evidence: 'PROPERTY_HEURISTIC',
                  confidence: 'MEDIUM',
                  text: st.text,
                  ph: st.ph,
                  plural: st.plural,
                  branch: st.branch,
                  key: kn,
                });
            for (const d of r.dyn) emitDynamic(pr, d, 'dynamic_property_text', `${pathName}.${kn}`);
          }
        };
        walkObj(init, nm);
      } else if (ts.isArrayLiteralExpression(init) && COPYISH.test(nm)) {
        for (const el of init.elements) {
          const r = resolveValue(el, sf);
          for (const st of r.strings)
            if (LETTER.test(st.text) && !/^[a-z0-9_.:/-]+$/.test(st.text))
              emit(el, {
                kind: 'list_item_text',
                prop: nm,
                evidence: 'PROPERTY_HEURISTIC',
                confidence: 'MEDIUM',
                text: st.text,
                ph: st.ph,
                plural: st.plural,
                branch: st.branch,
                key: nm,
              });
        }
      }
    }
    // --- service refusals: serviceError(code, 'message'). Some reach a screen word for word.
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'serviceError' &&
      node.arguments[1]
    ) {
      const r = resolveValue(node.arguments[1], sf);
      for (const st of r.strings)
        if (LETTER.test(st.text) && /\s/.test(st.text))
          emit(node.arguments[1], {
            kind: 'service_error_message',
            prop: `serviceError(${node.arguments[0]?.getText(sf).replace(/['"]/g, '')})`,
            evidence: 'ERROR_CALL',
            confidence: 'MEDIUM',
            text: st.text,
            ph: st.ph,
            plural: st.plural,
            branch: st.branch,
          });
      for (const d of r.dyn) emitDynamic(node, d, 'dynamic_property_text', 'serviceError');
    }
    // --- validation messages: z.string().min(1, 'msg'), .refine(fn, 'msg' | {message})
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const m = node.expression.name.text;
      if (
        /^(min|max|length|email|url|uuid|regex|refine|superRefine|nonempty|positive|int|startsWith|endsWith|includes|datetime|date|enum|literal)$/.test(
          m,
        ) &&
        node.arguments.length
      ) {
        const last = node.arguments[node.arguments.length - 1];
        const target = ts.isObjectLiteralExpression(last)
          ? last.properties.find(
              (p) =>
                ts.isPropertyAssignment(p) &&
                ['message', 'error', 'required_error', 'invalid_type_error'].includes(
                  p.name.getText(),
                ),
            )?.initializer
          : last;
        if (
          target &&
          (ts.isStringLiteralLike(target) || ts.isTemplateExpression(target)) &&
          /\s/.test(stringParts(target, sf)?.text ?? '')
        ) {
          const s = stringParts(target, sf);
          emit(target, {
            kind: 'validation_message',
            prop: `.${m}()`,
            evidence: 'VALIDATION',
            confidence: 'HIGH',
            text: s.text,
            ph: s.ph,
          });
        }
      }
    }
    // --- candidate sentences elsewhere (kept separate, never counted as confirmed display)
    if (
      (ts.isStringLiteral(node) ||
        ts.isNoSubstitutionTemplateLiteral(node) ||
        ts.isTemplateExpression(node)) &&
      !node.__seen
    ) {
      candidate(node);
    }
    ts.forEachChild(node, visit);
  }

  const _seenText = new Set();
  function candidate(node) {
    const p = node.parent;
    if (!p) return;
    if (
      ts.isImportDeclaration(p) ||
      ts.isExportDeclaration(p) ||
      ts.isLiteralTypeNode(p) ||
      ts.isCaseClause(p) ||
      ts.isExternalModuleReference(p) ||
      ts.isComputedPropertyName(p) ||
      ts.isPropertySignature(p) ||
      ts.isEnumMember(p)
    )
      return;
    if (ts.isPropertyAssignment(p) && p.name === node) return;
    if (ts.isElementAccessExpression(p) && p.argumentExpression === node) return;
    if (
      ts.isBinaryExpression(p) &&
      [
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
      ].includes(p.operatorToken.kind)
    )
      return;
    if (ts.isJsxAttribute(p) || (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent))) return; // handled by attribute rules; non-display attrs ignored
    if (ts.isJsxExpression(p) && (ts.isJsxElement(p.parent) || ts.isJsxFragment(p.parent))) return;
    // already captured via a display-bearing property/ternary chain
    for (
      let q = p;
      q &&
      (ts.isConditionalExpression(q) ||
        ts.isParenthesizedExpression(q) ||
        ts.isBinaryExpression(q) ||
        ts.isAsExpression(q));
      q = q.parent
    ) {
      if (ts.isJsxExpression(q.parent) && !ts.isJsxAttribute(q.parent.parent)) return;
    }
    if (
      ts.isPropertyAssignment(p) &&
      (STRONG_KEYS.has(p.name.getText()) ||
        /^[A-Z][A-Z0-9_]{2,}$/.test(p.name.getText()) ||
        /^[a-z]+(_[a-z]+)+$/.test(p.name.getText()))
    )
      return;
    // call arguments that are patterns/lookup keys
    if (ts.isCallExpression(p)) {
      const callee = p.expression.getText(sf);
      if (
        /\.(get|has|set|delete|includes|startsWith|endsWith|split|replace|replaceAll|match|test|localeCompare|indexOf|push|join|padStart|padEnd|append|getAll|forEach|header|cookie|select|from|where|toLowerCase|toUpperCase)$/.test(
          callee,
        ) ||
        /^(require|import|fetch|RegExp|Symbol|Error|TypeError|RangeError|Number|String|parseInt|parseFloat|setHeader|getenv|readEnv|process\.env|sql|eq|and|or|inArray|desc|asc|count|ilike|like|redirect|revalidatePath|revalidateTag|cache|notFound)$/.test(
          callee,
        )
      )
        return;
      if (/console\.|logger\.|log\.|warn$|debug$|\.info$/.test(callee)) return;
    }
    if (ts.isNewExpression(p)) {
      const callee = p.expression.getText(sf);
      if (/(^|\.)\w*Error$/.test(callee)) {
        countExcluded('internal_error_literal');
        return;
      }
      if (/^(RegExp|URL|Set|Map|Date|Headers|Request|Response)$/.test(callee)) return;
    }
    const parts = stringParts(node, sf);
    if (!parts) return;
    const t = normWs(parts.text);
    if (!looksLikeSentence(t) || TW_LIKE(t)) return;
    if (t.length > 1200) return;
    emit(node, {
      kind: 'candidate_sentence',
      evidence: 'CANDIDATE_ONLY',
      confidence: 'LOW',
      text: t,
      ph: parts.ph,
      plural: parts.plural,
    });
  }

  visit(sf);
}

// ---------------------------------------------------------------- run
for (const f of files) {
  try {
    processFile(f);
  } catch (e) {
    console.error('FAILED', f, e.message);
    countExcluded('parse_failure');
  }
}

// ---------------------------------------------------------------- de-duplicate overlaps
// A string reached through two rules (for example an attribute and a property rule) keeps its strongest evidence.
const RANK = {
  CATALOGUE: 0,
  SYNTAX_JSX: 1,
  SYNTAX_JSX_COMPOSED: 1,
  SYNTAX_JSX_EXPR: 1,
  SYNTAX_ATTR: 1,
  VALIDATION: 1,
  PROP_JSX: 2,
  PROPERTY_HEURISTIC: 3,
  CANDIDATE_ONLY: 4,
};
const byPos = new Map();
for (const r of rows) {
  const k = `${r.file}:${r.line_start}:${r.line_end}:${r.english}`;
  const prev = byPos.get(k);
  if (!prev || (RANK[r.evidence] ?? 9) < (RANK[prev.evidence] ?? 9)) byPos.set(k, r);
}
const unique = [...byPos.values()];

fs.writeFileSync(
  path.join(OUT, 'census.json'),
  JSON.stringify(
    {
      mainSha: MAIN_SHA,
      filesScanned: files.length,
      testFilesSkipped: skippedTests,
      notScanned: NOT_SCANNED_GLOBS,
      excluded,
      rows: unique,
      dynamic: dynamicRows,
      fileStats,
    },
    null,
    0,
  ),
);
const ev = {};
for (const r of unique) ev[r.evidence] = (ev[r.evidence] ?? 0) + 1;
process.stdout.write(
  `${JSON.stringify({ mainSha: MAIN_SHA, filesScanned: files.length, rows: unique.length, dynamic: dynamicRows.length, evidence: ev, excluded }, null, 2)}\n`,
);
