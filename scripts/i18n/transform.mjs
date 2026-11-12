/**
 * Per-file analysis and rewrite for the i18n extraction codemod.
 *
 * analyzeFile() finds every user-visible string the v1 rules can move safely (JSX text, text with
 * simple values, literal branches of ?: && || ??, simple template literals, accessible attributes
 * and display props) and every one they cannot, with a reason. rewriteFile() turns the accepted
 * units into t('key', params) calls, adds `const t = useT(catalog)` (client) or
 * `const t = getServerT(catalog)` (server) as the first statement of each component that uses
 * them, `await primeLocale()` to async page and layout default exports, and the imports.
 * Nothing ambiguous is guessed: it is reported instead.
 */
import path from 'node:path';
import ts from 'typescript';
import { quote } from './catalog.mjs';
import { decodeEntities, renderedJsxText } from './jsx-text.mjs';
import {
  A11Y_ATTRS,
  BLOCK_TAGS,
  CODE_TAGS,
  DISPLAY_PROPS,
  HIGH_CONFIDENCE_PROPS,
  HOOK_RE,
  LETTER,
  RAW_TAGS,
  ROUTE_ENTRY_RE,
  cleanName,
  exprName,
  isPascal,
  looksLikeText,
  normWs,
} from './rules.mjs';

const WRAPPERS = new Set(['forwardRef', 'memo', 'React.forwardRef', 'React.memo']);
const RUNTIME = {
  client: 'apps/web/src/components/i18n-provider',
  server: 'apps/web/src/lib/i18n-server',
};

const unwrap = (e) => {
  let n = e;
  while (
    ts.isParenthesizedExpression(n) ||
    ts.isAsExpression(n) ||
    ts.isNonNullExpression(n) ||
    ts.isSatisfiesExpression(n) ||
    ts.isTypeAssertionExpression(n)
  )
    n = n.expression;
  return n;
};
const isStr = (n) => ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n);
const isFnLike = (n) =>
  ts.isFunctionDeclaration(n) ||
  ts.isFunctionExpression(n) ||
  ts.isArrowFunction(n) ||
  ts.isMethodDeclaration(n) ||
  ts.isConstructorDeclaration(n) ||
  ts.isGetAccessorDeclaration(n) ||
  ts.isSetAccessorDeclaration(n);
const hasMod = (n, kind) => (ts.getModifiers(n) ?? []).some((m) => m.kind === kind);
const isAsync = (fn) => hasMod(fn, ts.SyntaxKind.AsyncKeyword);

/** Name of the component a function is, or null when it is not one. */
export function componentName(fn) {
  if (ts.isFunctionDeclaration(fn)) {
    if (fn.name && isPascal(fn.name.text)) return fn.name.text;
    if (hasMod(fn, ts.SyntaxKind.ExportKeyword) && hasMod(fn, ts.SyntaxKind.DefaultKeyword))
      return fn.name?.text ?? 'default';
    return null;
  }
  if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn)) return null;
  if (ts.isFunctionExpression(fn) && fn.name && isPascal(fn.name.text)) return fn.name.text;
  let child = fn;
  let p = fn.parent;
  while (
    p &&
    ts.isCallExpression(p) &&
    WRAPPERS.has(p.expression.getText()) &&
    p.arguments[0] === child
  ) {
    child = p;
    p = p.parent;
  }
  if (p && ts.isVariableDeclaration(p) && ts.isIdentifier(p.name) && isPascal(p.name.text))
    return p.name.text;
  if (p && ts.isExportAssignment(p)) return 'default';
  return null;
}

function nearestFn(node) {
  for (let p = node.parent; p; p = p.parent) if (isFnLike(p)) return p;
  return null;
}

/** The component whose body will hold `const t`, or the reason there is none. */
export function findHost(node) {
  let fn = nearestFn(node);
  if (!fn) return { reason: 'module_level' };
  while (fn) {
    if (!ts.isArrowFunction(fn) && !ts.isFunctionExpression(fn) && !ts.isFunctionDeclaration(fn))
      return { reason: 'class_member' };
    if (componentName(fn)) return { host: fn };
    fn = nearestFn(fn);
  }
  return { reason: 'non_component_function' };
}

function typeIsStrNum(t, checker) {
  const F = ts.TypeFlags;
  if (t.flags & (F.Any | F.Unknown | F.Never)) return false;
  if (t.isUnion()) return t.types.every((m) => typeIsStrNum(m, checker));
  if (t.isIntersection()) return t.types.some((m) => typeIsStrNum(m, checker));
  return (t.flags & (F.StringLike | F.NumberLike)) !== 0;
}
function typeIsNumber(t) {
  const F = ts.TypeFlags;
  if (t.flags & (F.Any | F.Unknown | F.Never)) return false;
  if (t.isUnion()) return t.types.every(typeIsNumber);
  return (t.flags & F.NumberLike) !== 0;
}
/** A slot typed as a fixed set of strings ('Save' | 'Cancel') cannot take t()'s string. */
function contextIsLiteralUnion(node, checker) {
  const ctx = checker.getContextualType(node);
  if (!ctx) return false;
  const F = ts.TypeFlags;
  const members = (ctx.isUnion() ? ctx.types : [ctx]).filter(
    (m) => !(m.flags & (F.Undefined | F.Null | F.Void)),
  );
  if (!members.length) return false;
  return members.every((m) => m.flags & (F.StringLiteral | F.TemplateLiteral | F.StringMapping));
}

/** Leaves of an expression a JSX slot renders: literal branches of ?: && || ?? plus concatenations. */
function resolveLeaves(expr, out = { leaves: [], concat: [] }) {
  const n = unwrap(expr);
  if (ts.isConditionalExpression(n)) {
    resolveLeaves(n.whenTrue, out);
    resolveLeaves(n.whenFalse, out);
  } else if (ts.isBinaryExpression(n)) {
    const k = n.operatorToken.kind;
    if (k === ts.SyntaxKind.AmpersandAmpersandToken) resolveLeaves(n.right, out);
    else if (k === ts.SyntaxKind.BarBarToken || k === ts.SyntaxKind.QuestionQuestionToken) {
      resolveLeaves(n.left, out);
      resolveLeaves(n.right, out);
    } else if (k === ts.SyntaxKind.PlusToken) out.concat.push(n);
  } else if (isStr(n) || ts.isTemplateExpression(n)) out.leaves.push(n);
  return out;
}
const templateHasLetters = (tpl) =>
  LETTER.test(tpl.head.text) || tpl.templateSpans.some((s) => LETTER.test(s.literal.text));
const leafHasLetters = (leaf) =>
  ts.isTemplateExpression(leaf) ? templateHasLetters(leaf) : LETTER.test(leaf.text);

/** Placeholder names, census style (`user.name` -> name), unique per message. */
class ParamNamer {
  constructor(sf) {
    this.sf = sf;
    this.byText = new Map();
    this.used = new Set();
    this.list = [];
  }
  nameFor(expr) {
    const text = expr.getText(this.sf);
    const known = this.byText.get(text);
    if (known) return known;
    const base = cleanName(exprName(expr));
    let name = base;
    for (let i = 2; this.used.has(name); i++) name = `${base}${i}`;
    this.used.add(name);
    this.byText.set(text, name);
    this.list.push({ name, text, shorthand: ts.isIdentifier(expr) && expr.text === name });
    return name;
  }
}

export function analyzeFile({ rel, sf, checker }) {
  const lineOf = (n) => sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;
  const units = [];
  const skips = [];
  const handled = new Set();
  const skip = (node, kind, text, reason) => {
    handled.add(node);
    skips.push({ file: rel, line: lineOf(node), kind, text: normWs(text), reason });
  };

  // ---------- expressions inside a sentence
  function pluralOf(cond) {
    const c = unwrap(cond.condition);
    if (!ts.isBinaryExpression(c)) return null;
    const op = c.operatorToken.kind;
    const K = ts.SyntaxKind;
    const eq = op === K.EqualsEqualsEqualsToken || op === K.EqualsEqualsToken;
    const ne = op === K.ExclamationEqualsEqualsToken || op === K.ExclamationEqualsToken;
    if (!eq && !ne) return null;
    const l = unwrap(c.left);
    const r = unwrap(c.right);
    const isOne = (x) => ts.isNumericLiteral(x) && x.text === '1';
    const v = isOne(r) ? l : isOne(l) ? r : null;
    const wt = unwrap(cond.whenTrue);
    const wf = unwrap(cond.whenFalse);
    if (!v || !isStr(wt) || !isStr(wf)) return null;
    return { varExpr: v, one: eq ? wt.text : wf.text, other: eq ? wf.text : wt.text };
  }
  function partsOfExpr(expr) {
    const e = unwrap(expr);
    if (isStr(e)) return { parts: [{ text: e.text }] };
    if (ts.isTemplateExpression(e)) return partsOfTemplate(e);
    if (ts.isConditionalExpression(e)) {
      const p = pluralOf(e);
      if (!p) return { error: 'conditional_inside_sentence' };
      if (!typeIsNumber(checker.getTypeAtLocation(p.varExpr)))
        return { error: 'plural_variable_not_number' };
      return { parts: [{ plural: p }] };
    }
    if (ts.isBinaryExpression(e) && e.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return { error: 'string_concatenation' };
    if (
      ts.isIdentifier(e) ||
      ts.isPropertyAccessExpression(e) ||
      ts.isElementAccessExpression(e) ||
      ts.isCallExpression(e)
    ) {
      if (ts.isCallExpression(e) && HOOK_RE.test(exprName(e.expression)))
        return { error: 'expression_not_simple' };
      if (!typeIsStrNum(checker.getTypeAtLocation(e), checker))
        return { error: 'param_type_not_string_or_number' };
      return { parts: [{ param: e }] };
    }
    return { error: 'expression_not_simple' };
  }
  function partsOfTemplate(tpl) {
    const parts = [{ text: tpl.head.text }];
    for (const span of tpl.templateSpans) {
      const r = partsOfExpr(span.expression);
      if (r.error) return r;
      parts.push(...r.parts, { text: span.literal.text });
    }
    return { parts };
  }
  /** parts -> message. `trimEdges` moves spaces at the ends outside the message (JSX children). */
  function buildMessage(parts, trimEdges) {
    const merged = [];
    for (const p of parts) {
      const last = merged[merged.length - 1];
      if (p.text !== undefined && last && last.text !== undefined) last.text += p.text;
      else merged.push({ ...p });
    }
    let lead = '';
    let trail = '';
    if (trimEdges) {
      const first = merged[0];
      if (first?.text !== undefined) {
        lead = /^ */.exec(first.text)[0];
        first.text = first.text.slice(lead.length);
      }
      const last = merged[merged.length - 1];
      if (last?.text !== undefined) {
        trail = / *$/.exec(last.text)[0];
        last.text = last.text.slice(0, last.text.length - trail.length);
      }
    }
    const texts = merged.flatMap((p) =>
      p.text !== undefined ? [p.text] : p.plural ? [p.plural.one, p.plural.other] : [],
    );
    if (texts.some((t) => /[{}]/.test(t))) return { error: 'literal_brace' };
    const plurals = merged.filter((p) => p.plural);
    if (plurals.length && texts.some((t) => t.includes('#'))) return { error: 'plural_hash' };
    if (new Set(plurals.map((p) => p.plural.varExpr.getText(sf))).size > 1)
      return { error: 'multiple_plural_variables' };
    const namer = new ParamNamer(sf);
    const render = (form) =>
      merged
        .map((p) =>
          p.text !== undefined
            ? p.text
            : p.param
              ? `{${namer.nameFor(p.param)}}`
              : form === 'one'
                ? p.plural.one
                : p.plural.other,
        )
        .join('');
    let english;
    let slugSource;
    if (plurals.length) {
      const v = namer.nameFor(plurals[0].plural.varExpr);
      const one = render('one');
      const other = render('other');
      english = `{${v}, plural, =1 {${one}} other {${other}}}`;
      slugSource = other;
    } else {
      english = render('other');
      slugSource = english;
    }
    if (!LETTER.test(slugSource)) return { error: 'no_letters' };
    return { english, slugSource, params: namer.list, lead, trail };
  }

  // ---------- unit creation
  function addUnit(kind, anchor, lineNode, range, wrap, msg, censusText, contextNode) {
    if (contextNode && contextIsLiteralUnion(contextNode, checker))
      return skip(anchor, kind, msg.english, 'prop_typed_as_literal_union');
    const h = findHost(anchor);
    if (h.reason) return skip(anchor, kind, msg.english, h.reason);
    handled.add(anchor);
    units.push({
      file: rel,
      kind,
      line: lineOf(lineNode),
      start: range[0],
      end: range[1],
      wrap,
      host: h.host,
      english: msg.english,
      slugSource: msg.slugSource,
      params: msg.params,
      lead: msg.lead ?? '',
      trail: msg.trail ?? '',
      censusText: normWs(censusText ?? msg.english),
    });
  }

  /** Literal leaves of an expression slot (JSX child or attribute value). */
  function convertLeaves(expr, kind, lineNode, opts = {}) {
    const { leaves, concat } = resolveLeaves(expr);
    for (const c of concat)
      if (LETTER.test(c.getText(sf))) skip(c, kind, c.getText(sf), 'string_concatenation');
    for (const leaf of leaves) {
      if (!leafHasLetters(leaf)) continue;
      const text = ts.isTemplateExpression(leaf) ? leaf.getText(sf) : leaf.text;
      if (opts.idLike && isStr(leaf) && /^[a-z0-9_.-]+$/.test(leaf.text.trim())) {
        skip(leaf, kind, text, 'id_like_value');
        continue;
      }
      const r = ts.isTemplateExpression(leaf)
        ? partsOfTemplate(leaf)
        : { parts: [{ text: leaf.text }] };
      if (r.error) {
        skip(leaf, kind, text, r.error);
        continue;
      }
      const msg = buildMessage(r.parts, false);
      if (msg.error) {
        if (msg.error !== 'no_letters') skip(leaf, kind, text, msg.error);
        continue;
      }
      addUnit(kind, leaf, lineNode, [leaf.getStart(sf), leaf.end], 'call', msg, msg.english, leaf);
    }
  }

  // ---------- JSX children
  const tagOf = (n) =>
    ts.isJsxElement(n)
      ? n.openingElement.tagName.getText(sf)
      : ts.isJsxSelfClosingElement(n)
        ? n.tagName.getText(sf)
        : '';
  const isEl = (c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c) || ts.isJsxFragment(c);
  const letterText = (c) => ts.isJsxText(c) && LETTER.test(c.text);
  const literalLetters = (c) => {
    if (!ts.isJsxExpression(c) || !c.expression) return false;
    const r = resolveLeaves(c.expression);
    return (
      r.leaves.some((l) => leafHasLetters(l)) || r.concat.some((x) => LETTER.test(x.getText(sf)))
    );
  };
  function hasLetterContent(n) {
    let found = false;
    const v = (x) => {
      if (found) return;
      if (letterText(x) || literalLetters(x)) found = true;
      else if (isEl(x)) for (const c of x.children ?? []) v(c);
    };
    v(n);
    return found;
  }
  /** Report every text and literal leaf under a node (not attributes) with one reason. */
  function reportSubtree(n, reason, kind) {
    const v = (x) => {
      if (handled.has(x)) return;
      if (letterText(x)) skip(x, kind, x.text, reason);
      else if (ts.isJsxExpression(x) && x.expression) {
        handled.add(x);
        for (const l of resolveLeaves(x.expression).leaves)
          if (leafHasLetters(l)) skip(l, kind, l.getText(sf), reason);
      } else if (isEl(x)) {
        handled.add(x);
        for (const c of x.children ?? []) v(c);
      }
    };
    v(n);
  }

  function composeSegment(seg, parent) {
    const parts = [];
    let census = '';
    let error = null;
    for (const c of seg) {
      if (ts.isJsxText(c)) {
        const r = renderedJsxText(c.text);
        if (r.error) {
          error = r.error.split(':')[0];
          break;
        }
        parts.push({ text: r.text });
        census += c.text.replace(/\s+/g, ' ');
      } else if (c.expression) {
        const r = partsOfExpr(c.expression);
        if (r.error) {
          error = r.error;
          break;
        }
        parts.push(...r.parts);
        const e = unwrap(c.expression);
        census += isStr(e) ? e.text : `{${cleanName(exprName(c.expression))}}`;
      }
    }
    const textOf = () => normWs(seg.map((c) => c.getText(sf)).join(''));
    const kind =
      seg.filter((c) => !ts.isJsxText(c) || c.text.trim()).length > 1 ? 'jsx_composed' : 'jsx_text';
    const anchor = seg.find(letterText);
    if (error) {
      for (const c of seg) handled.add(c);
      return skip(anchor, kind, textOf(), error);
    }
    const msg = buildMessage(parts, true);
    if (msg.error) {
      for (const c of seg) handled.add(c);
      return skip(anchor, kind, textOf(), msg.error);
    }
    for (const c of seg) handled.add(c);
    addUnit(
      kind,
      anchor,
      kind === 'jsx_text' ? anchor : parent,
      [seg[0].pos, seg[seg.length - 1].end],
      'jsx',
      msg,
      census,
      null,
    );
  }

  function processChildren(P) {
    if (handled.has(P)) return;
    const tag = tagOf(P);
    if (RAW_TAGS.has(tag)) {
      const mark = (x) => {
        handled.add(x);
        ts.forEachChild(x, mark);
      };
      mark(P);
      return;
    }
    if (CODE_TAGS.has(tag)) return reportSubtree(P, 'code_element', 'jsx_text');
    const kids = P.children;
    const sentence = kids.some((c) => letterText(c) || literalLetters(c));
    if (!sentence) return;
    // A sentence split by an inline element (a link, bold text, a value in a tag) is one unit
    // with markup: v1 leaves it whole.
    const content = kids.map((c) => letterText(c) || (ts.isJsxExpression(c) && !!c.expression));
    let split = false;
    kids.forEach((c, i) => {
      if (!isEl(c) || BLOCK_TAGS.has(tagOf(c))) return;
      if (hasLetterContent(c)) split = true;
      else if (content.slice(0, i).some(Boolean) && content.slice(i + 1).some(Boolean))
        split = true;
    });
    if (split) {
      for (const c of kids) {
        if (isEl(c) && BLOCK_TAGS.has(tagOf(c))) continue;
        reportSubtree(c, 'sentence_split_by_inline_element', 'jsx_composed');
      }
      return;
    }
    // Segments between elements; a JSX comment splits a segment too.
    const segments = [];
    let cur = [];
    for (const c of kids) {
      if (isEl(c)) {
        if (cur.length) segments.push(cur);
        cur = [];
      } else cur.push(c);
    }
    if (cur.length) segments.push(cur);
    for (const seg of segments) {
      const pieces = [];
      let piece = [];
      for (const c of seg) {
        if (ts.isJsxExpression(c) && !c.expression) {
          pieces.push(piece);
          piece = [];
        } else piece.push(c);
      }
      pieces.push(piece);
      const lettered = pieces.filter((p) => p.some(letterText));
      if (lettered.length > 1) {
        for (const p of pieces)
          for (const c of p) reportSubtree(c, 'jsx_comment_inside_text', 'jsx_composed');
        continue;
      }
      for (const p of pieces) {
        if (!p.length) continue;
        if (p.some(letterText)) composeSegment(p, P);
        else
          for (const c of p)
            if (ts.isJsxExpression(c) && c.expression && !handled.has(c))
              convertLeaves(c.expression, 'jsx_expr_literal', c);
      }
    }
  }

  // ---------- attributes
  function processAttr(attr) {
    const name = attr.name.getText(sf);
    const opening = attr.parent.parent;
    const tag = opening.tagName.getText(sf);
    const custom = /^[A-Z]/.test(tag) || tag.includes('.');
    const a11y =
      A11Y_ATTRS.has(name) ||
      (!custom && name === 'label' && /^(option|optgroup|track)$/.test(tag));
    const display = custom && DISPLAY_PROPS.has(name);
    if (!a11y && !display) return;
    const kind = a11y ? 'jsx_attr_accessible' : 'jsx_prop_display';
    const idLike = !a11y && !HIGH_CONFIDENCE_PROPS.has(name);
    const init = attr.initializer;
    if (!init) return;
    if (ts.isStringLiteral(init)) {
      const d = decodeEntities(init.text);
      if (d.error)
        return LETTER.test(init.text) && skip(init, kind, init.text, 'unknown_html_entity');
      const text = d.text;
      if (!LETTER.test(text)) return;
      if (/[\r\n]/.test(text)) return skip(init, kind, text, 'newline_in_attribute_string');
      if (idLike && /^[a-z0-9_.-]+$/.test(text.trim()))
        return skip(init, kind, text, 'id_like_value');
      if (/[{}]/.test(text)) return skip(init, kind, text, 'literal_brace');
      const msg = { english: text, slugSource: text, params: [] };
      return addUnit(kind, init, attr, [init.getStart(sf), init.end], 'attr', msg, text, init);
    }
    if (ts.isJsxExpression(init) && init.expression)
      convertLeaves(init.expression, kind, attr, { idLike });
  }

  function visit(n) {
    if (ts.isJsxElement(n) || ts.isJsxFragment(n)) processChildren(n);
    if (ts.isJsxAttribute(n)) processAttr(n);
    ts.forEachChild(n, visit);
  }
  visit(sf);

  // ---------- everything else that reads like words: reported for v2 sizing, never touched
  function contextReason(node) {
    if (node.parent && ts.isNewExpression(node.parent)) return 'thrown_error_message';
    const fn = nearestFn(node);
    let first = null;
    for (let p = node.parent; p && p !== fn && !first; p = p.parent) {
      if (ts.isJsxAttribute(p)) first = 'attr';
      else if (
        ts.isCallExpression(p) &&
        p.arguments.some((a) => a.pos <= node.pos && node.end <= a.end)
      ) {
        const callee = p.expression.getText(sf);
        if (/^console\./.test(callee) || callee === 'require') return null;
        first = 'call';
      } else if (ts.isObjectLiteralExpression(p) || ts.isArrayLiteralExpression(p))
        first = 'object';
      else if (ts.isJsxExpression(p) || ts.isJsxElement(p)) first = 'jsx';
    }
    if (first === 'attr') return 'non_display_prop';
    if (first === 'call') return 'call_argument';
    if (first === 'jsx') return 'jsx_other';
    if (!fn) {
      if (first === 'object') return 'module_label_map';
      for (let p = node.parent; p; p = p.parent)
        if (ts.isVariableDeclaration(p)) return 'named_constant';
      return 'module_level_string';
    }
    if (findHost(node).host)
      return first === 'object' ? 'object_property_in_component' : 'component_non_jsx_string';
    return 'helper_function_string';
  }
  function sweep(n) {
    if (handled.has(n)) return;
    if (
      ts.isImportDeclaration(n) ||
      ts.isExportDeclaration(n) ||
      ts.isLiteralTypeNode(n) ||
      ts.isTypeNode(n)
    )
      return;
    if (ts.isExpressionStatement(n) && isStr(n.expression) && ts.isSourceFile(n.parent)) return;
    const isText = ts.isJsxText(n) ? LETTER.test(n.text) : isStr(n) || ts.isTemplateExpression(n);
    if (isText) {
      const p = n.parent;
      const isName =
        p &&
        ((ts.isPropertyAssignment(p) && p.name === n) ||
          (ts.isElementAccessExpression(p) && p.argumentExpression === n) ||
          ts.isCaseClause(p) ||
          (ts.isBinaryExpression(p) && /^(===|!==|==|!=)$/.test(p.operatorToken.getText(sf))));
      const text = ts.isJsxText(n) ? n.text : ts.isTemplateExpression(n) ? n.getText(sf) : n.text;
      const probe = ts.isTemplateExpression(n)
        ? text.slice(1, -1).replace(/\$\{[^}]*\}/g, ' ')
        : text;
      if (!isName && looksLikeText(probe)) {
        const reason = contextReason(n);
        if (reason) skip(n, 'unscoped', text, reason);
      }
      if (ts.isTemplateExpression(n)) return;
    }
    ts.forEachChild(n, sweep);
  }
  sweep(sf);

  units.sort((a, b) => a.start - b.start);
  skips.sort((a, b) => a.line - b.line || (a.text < b.text ? -1 : 1));
  return { units, skips };
}

// ---------------------------------------------------------------- planning and rewriting

/**
 * How `t` is already used in a component. `existing`: our own `const t = useT|getServerT(catalog)`
 * at the top of the body. `conflict`: a `t` that would clash for the whole component (a parameter
 * or another top-level `t`). `shadows`: source ranges where an inner `t` (a callback parameter,
 * a block variable) hides ours, so strings there cannot use it.
 */
function declaredT(host, sf, catalogIdent) {
  let existing = null;
  let conflict = null;
  const shadows = [];
  const body = host.body;
  const own = (decl) => {
    let init = decl.initializer;
    if (init && ts.isAwaitExpression(init)) init = init.expression;
    if (
      init &&
      ts.isCallExpression(init) &&
      ts.isIdentifier(init.expression) &&
      /^(useT|getServerT|getT)$/.test(init.expression.text) &&
      init.arguments.length === 1 &&
      ts.isIdentifier(init.arguments[0])
    )
      return { fn: init.expression.text, catalog: init.arguments[0].text };
    return null;
  };
  const legacy = (decl) => {
    let init = decl.initializer;
    if (init && ts.isAwaitExpression(init)) init = init.expression;
    return (
      !!init && ts.isCallExpression(init) && /createTranslator/.test(init.expression.getText(sf))
    );
  };
  const named = (b) => !!b && ts.isIdentifier(b) && b.text === 't';
  const scopeOf = (n) => {
    for (let p = n.parent; p; p = p.parent)
      if (
        isFnLike(p) ||
        ts.isBlock(p) ||
        ts.isForStatement(p) ||
        ts.isForOfStatement(p) ||
        ts.isForInStatement(p) ||
        ts.isCatchClause(p) ||
        ts.isSourceFile(p)
      )
        return p;
    return host;
  };
  const fnOf = (n) => {
    for (let p = n.parent; p; p = p.parent) if (isFnLike(p)) return p;
    return host;
  };
  const isHostLevel = (scope) => scope === host || scope === body;
  const mark = (scope, reason) => {
    if (isHostLevel(scope)) conflict = conflict ?? reason;
    else shadows.push([scope.getStart(sf), scope.end]);
  };
  const visit = (n) => {
    if (n !== host && isFnLike(n) && componentName(n)) return; // nested component: own scope
    if (ts.isParameter(n) && named(n.name)) mark(n.parent, 'name_conflict_t');
    else if (ts.isBindingElement(n) && named(n.name)) {
      let d = n.parent;
      while (
        d &&
        (ts.isObjectBindingPattern(d) || ts.isArrayBindingPattern(d) || ts.isBindingElement(d))
      )
        d = d.parent;
      mark(d && ts.isParameter(d) ? d.parent : scopeOf(d ?? n), 'name_conflict_t');
    } else if (
      (ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n)) &&
      n !== host &&
      named(n.name)
    )
      mark(scopeOf(n), 'name_conflict_t');
    else if (ts.isVariableDeclaration(n) && named(n.name)) {
      const o = own(n);
      const list = n.parent;
      let scope;
      if (ts.isCatchClause(list)) scope = list;
      else if (!(list.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const))) scope = fnOf(n);
      else if (
        ts.isForStatement(list.parent) ||
        ts.isForOfStatement(list.parent) ||
        ts.isForInStatement(list.parent)
      )
        scope = list.parent;
      else scope = scopeOf(list.parent);
      if (o && scope === body) {
        if (o.catalog === catalogIdent) existing = o.fn;
        else conflict = conflict ?? 'other_catalog_in_scope';
      } else mark(scope, legacy(n) ? 'legacy_translator_t' : 'name_conflict_t');
    }
    ts.forEachChild(n, visit);
  };
  for (const p of host.parameters) visit(p);
  if (body) visit(body);
  if (!conflict && outerT(host, sf, catalogIdent)) conflict = 'name_conflict_t_outer';
  return { existing, conflict, shadows };
}

/**
 * Is a `t` visible to the host from an enclosing function (other than our own translator for the
 * same catalogue)? A new `const t` in the host would hide it from code the host already has.
 */
function outerT(host, sf, catalogIdent) {
  const named = (b) => !!b && ts.isIdentifier(b) && b.text === 't';
  const hostPos = host.getStart(sf);
  for (let a = host.parent; a && !ts.isSourceFile(a); a = a.parent) {
    if (!isFnLike(a)) continue;
    if (a.parameters.some((p) => named(p.name))) return true;
    let found = false;
    const visit = (n) => {
      if (found || n === host) return;
      if (n !== a && isFnLike(n) && !(n.pos <= hostPos && hostPos < n.end)) return;
      if (ts.isVariableDeclaration(n) && named(n.name)) {
        let init = n.initializer;
        if (init && ts.isAwaitExpression(init)) init = init.expression;
        const ours =
          init &&
          ts.isCallExpression(init) &&
          /^(useT|getServerT|getT)$/.test(init.expression.getText(sf)) &&
          init.arguments[0]?.getText(sf) === catalogIdent;
        const block = n.parent.parent?.parent;
        const encloses = block && block.pos <= hostPos && hostPos < block.end;
        if (!ours && encloses) found = true;
      } else if (
        (ts.isFunctionDeclaration(n) || ts.isBindingElement(n) || ts.isParameter(n)) &&
        named(n.name)
      )
        found = true;
      ts.forEachChild(n, visit);
    };
    if (a.body) visit(a.body);
    if (found) return true;
  }
  return false;
}

/** Client components called as plain functions (`rows.map(Cell)`, `{Cell(x)}`) cannot hold a hook. */
function calledAsFunction(host, sf) {
  const name = componentName(host);
  if (!name || name === 'default') return false;
  let called = false;
  const visit = (n) => {
    if (called) return;
    if (ts.isIdentifier(n) && n.text === name) {
      const p = n.parent;
      const fine =
        ((ts.isJsxOpeningElement(p) ||
          ts.isJsxSelfClosingElement(p) ||
          ts.isJsxClosingElement(p)) &&
          p.tagName === n) ||
        (ts.isVariableDeclaration(p) && p.name === n) ||
        (ts.isFunctionDeclaration(p) && p.name === n) ||
        (ts.isFunctionExpression(p) && p.name === n) ||
        ts.isExportSpecifier(p) ||
        ts.isExportAssignment(p) ||
        ts.isPropertyAccessExpression(p) ||
        ts.isTypeQueryNode(p);
      if (!fine) called = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return called;
}

function moduleNames(sf) {
  const names = new Map(); // name -> module specifier ('' for local)
  for (const st of sf.statements) {
    if (ts.isImportDeclaration(st) && st.importClause) {
      const spec = st.moduleSpecifier.text;
      const ic = st.importClause;
      if (ic.name) names.set(ic.name.text, spec);
      const nb = ic.namedBindings;
      if (nb && ts.isNamedImports(nb)) for (const e of nb.elements) names.set(e.name.text, spec);
      if (nb && ts.isNamespaceImport(nb)) names.set(nb.name.text, spec);
    } else if (ts.isVariableStatement(st)) {
      for (const d of st.declarationList.declarations)
        if (ts.isIdentifier(d.name)) names.set(d.name.text, '');
    } else if ((ts.isFunctionDeclaration(st) || ts.isClassDeclaration(st)) && st.name)
      names.set(st.name.text, '');
  }
  return names;
}

export function defaultExportFn(sf) {
  for (const st of sf.statements) {
    if (
      ts.isFunctionDeclaration(st) &&
      hasMod(st, ts.SyntaxKind.ExportKeyword) &&
      hasMod(st, ts.SyntaxKind.DefaultKeyword)
    )
      return st;
    if (ts.isExportAssignment(st) && !st.isExportEquals) {
      const e = unwrap(st.expression);
      if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) return e;
      if (ts.isIdentifier(e)) {
        for (const s2 of sf.statements) {
          if (ts.isFunctionDeclaration(s2) && s2.name?.text === e.text) return s2;
          if (ts.isVariableStatement(s2))
            for (const d of s2.declarationList.declarations)
              if (ts.isIdentifier(d.name) && d.name.text === e.text && d.initializer) {
                const i = unwrap(d.initializer);
                if (ts.isArrowFunction(i) || ts.isFunctionExpression(i)) return i;
              }
        }
      }
    }
  }
  return null;
}

/** Repository path an import specifier points at ('@/x' is apps/web/src/x). */
export const resolveSpec = (fromRel, spec) =>
  spec.startsWith('@/')
    ? `apps/web/src/${spec.slice(2)}`
    : spec.startsWith('.')
      ? path.posix.normalize(path.posix.join(path.posix.dirname(fromRel), spec))
      : spec;
const relSpec = (fromRel, toRel) => {
  let r = path.posix.relative(path.posix.dirname(fromRel), toRel);
  if (!r.startsWith('.')) r = `./${r}`;
  return r;
};
const indentAt = (code, pos) => {
  const lineStart = code.lastIndexOf('\n', pos - 1) + 1;
  return /^[ \t]*/.exec(code.slice(lineStart))[0];
};

/**
 * Decide the file-level outcome. Returns { fileSkip } or { hosts, primeFn } where hosts maps a
 * component node to { existing, units } and primeFn is the route default export to prime.
 */
export function planFile({ rel, sf, mode, units, catalogIdent }) {
  if (!units.length) return { fileSkip: null, hosts: new Map(), primeFn: null };
  const names = moduleNames(sf);
  if (names.has('t')) return { fileSkip: 'name_conflict_t_module' };
  const runtimeNames = mode === 'client' ? ['useT'] : ['getServerT', 'primeLocale'];
  for (const n of [...runtimeNames, catalogIdent]) {
    const spec = names.get(n);
    if (spec === undefined) continue;
    const want = n === catalogIdent ? 'apps/web/src/i18n/' : RUNTIME[mode];
    const resolved = spec === '' ? '' : resolveSpec(rel, spec);
    if (!resolved.startsWith(want)) return { fileSkip: 'name_conflict_import' };
  }
  let primeFn = null;
  if (ROUTE_ENTRY_RE.test(rel)) {
    if (mode === 'client') return { fileSkip: 'client_route_entry' };
    primeFn = defaultExportFn(sf);
    if (!primeFn) return { fileSkip: 'route_entry_default_export_unresolved' };
    if (!isAsync(primeFn)) return { fileSkip: 'route_entry_not_async' };
  }
  const hosts = new Map();
  const unitSkips = [];
  for (const u of units) {
    let h = hosts.get(u.host);
    if (!h) {
      const d = declaredT(u.host, sf, catalogIdent);
      let reason = d.conflict;
      if (!reason && mode === 'client' && isAsync(u.host)) reason = 'async_client_component';
      if (!reason && mode === 'client' && calledAsFunction(u.host, sf))
        reason = 'component_called_as_function';
      if (!reason && u.host.asteriskToken) reason = 'generator_component';
      if (!reason && d.existing && (mode === 'client') !== (d.existing === 'useT'))
        reason = 'other_catalog_in_scope';
      h = { existing: d.existing, units: [], reason, shadows: d.shadows };
      hosts.set(u.host, h);
    }
    if (h.reason) unitSkips.push({ unit: u, reason: h.reason });
    else if (h.shadows.some(([s, e]) => s <= u.start && u.end <= e))
      unitSkips.push({ unit: u, reason: 'name_conflict_t' });
    else h.units.push(u);
  }
  for (const [k, h] of hosts) if (h.reason || !h.units.length) hosts.delete(k);
  if (!hosts.size) return { fileSkip: null, hosts, primeFn: null, unitSkips };
  return { fileSkip: null, hosts, primeFn, unitSkips };
}

const callText = (key, params) => {
  if (!params.length) return `t('${key}')`;
  const body = params.map((p) => (p.shorthand ? p.name : `${p.name}: ${p.text}`)).join(', ');
  return `t('${key}', { ${body} })`;
};
const spaceExpr = (s) => (s ? `{${quote(s).replace(/^"|"$/g, "'")}}` : '');

/** Apply a plan. keyOf(unit) gives each unit's key. Returns the new source text. */
export function rewriteFile({ rel, sf, mode, plan, catalogIdent, surface, keyOf }) {
  const code = sf.text;
  const edits = [];
  for (const h of plan.hosts.values())
    for (const u of h.units) {
      const call = callText(keyOf(u), u.params);
      const text =
        u.wrap === 'jsx'
          ? `${spaceExpr(u.lead)}{${call}}${spaceExpr(u.trail)}`
          : u.wrap === 'attr'
            ? `{${call}}`
            : call;
      edits.push({ start: u.start, end: u.end, text });
    }
  // statements at the top of each function
  const stmtsFor = new Map();
  const add = (fn, s) => stmtsFor.set(fn, [...(stmtsFor.get(fn) ?? []), s]);
  const need = new Set();
  if (plan.primeFn && plan.hosts.size) {
    const hasPrime = plan.primeFn.body?.getText(sf).match(/\bawait\s+primeLocale\(\)/);
    if (!hasPrime) {
      add(plan.primeFn, 'await primeLocale();');
      need.add('primeLocale');
    }
  }
  for (const [fn, h] of plan.hosts) {
    if (h.existing) continue;
    const fnName = mode === 'client' ? 'useT' : 'getServerT';
    add(fn, `const t = ${fnName}(${catalogIdent});`);
    need.add(fnName);
    need.add(catalogIdent);
  }
  for (const [fn, stmts] of stmtsFor) {
    const body = fn.body;
    if (ts.isBlock(body)) {
      const first = body.statements[0];
      const indent = first
        ? indentAt(code, first.getStart(sf))
        : `${indentAt(code, fn.getStart(sf))}  `;
      edits.push({
        start: body.getStart(sf) + 1,
        end: body.getStart(sf) + 1,
        text: stmts.map((s) => `\n${indent}${s}`).join(''),
      });
    } else {
      const base = indentAt(code, fn.getStart(sf));
      const indent = `${base}  `;
      edits.push({
        start: body.getStart(sf),
        end: body.getStart(sf),
        text: `{\n${stmts.map((s) => `${indent}${s}\n`).join('')}${indent}return `,
      });
      edits.push({ start: body.end, end: body.end, text: `;\n${base}}` });
    }
  }
  // imports
  const modules = [
    [relSpec(rel, RUNTIME.client), ['useT'].filter((n) => need.has(n))],
    [relSpec(rel, RUNTIME.server), ['getServerT', 'primeLocale'].filter((n) => need.has(n))],
    [relSpec(rel, `apps/web/src/i18n/${surface}`), [catalogIdent].filter((n) => need.has(n))],
  ];
  const imports = sf.statements.filter(ts.isImportDeclaration);
  const newLines = [];
  for (const [spec, wanted] of modules) {
    if (!wanted.length) continue;
    const target = resolveSpec(rel, spec);
    const decl = imports.find(
      (d) =>
        resolveSpec(rel, d.moduleSpecifier.text) === target &&
        !d.importClause?.isTypeOnly &&
        d.importClause?.namedBindings &&
        ts.isNamedImports(d.importClause.namedBindings),
    );
    const have = new Set(
      decl ? decl.importClause.namedBindings.elements.map((e) => e.name.text) : [],
    );
    const missing = wanted.filter((n) => !have.has(n));
    if (!missing.length) continue;
    if (decl) {
      const els = decl.importClause.namedBindings.elements;
      const last = els[els.length - 1];
      edits.push({ start: last.end, end: last.end, text: `, ${missing.join(', ')}` });
    } else newLines.push(`import { ${missing.join(', ')} } from '${spec}';`);
  }
  if (newLines.length) {
    const lastImport = imports[imports.length - 1];
    let at = 0;
    if (lastImport) at = lastImport.end;
    else {
      for (const st of sf.statements) {
        if (ts.isExpressionStatement(st) && isStr(st.expression)) at = st.end;
        else break;
      }
    }
    const text = at === 0 ? `${newLines.join('\n')}\n` : `\n${newLines.join('\n')}`;
    edits.push({ start: at, end: at, text });
  }
  edits.sort((a, b) => b.start - a.start || b.end - a.end);
  for (let i = 1; i < edits.length; i++) {
    const later = edits[i - 1];
    const earlier = edits[i];
    if (
      earlier.end > later.start &&
      !(earlier.start === earlier.end && later.start === earlier.start)
    )
      throw new Error(`${rel}: overlapping edits at ${earlier.start}-${earlier.end}`);
  }
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  const check = ts.createSourceFile(rel, out, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX);
  if (check.parseDiagnostics?.length)
    throw new Error(
      `${rel}: rewrite does not parse: ${ts.flattenDiagnosticMessageText(check.parseDiagnostics[0].messageText, ' ')}`,
    );
  return out;
}
