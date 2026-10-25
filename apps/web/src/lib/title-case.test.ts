import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { CONSENT_PLAIN } from './labels';
import { isTitleCase, toTitleCase } from './title-case';

describe('toTitleCase', () => {
  it('capitalises each word of a term, keeping small joining words lower case', () => {
    expect(toTitleCase('Share & care')).toBe('Share & Care');
    expect(toTitleCase('Ready for review')).toBe('Ready for Review');
    expect(toTitleCase('Where this information comes from')).toBe(
      'Where This Information Comes From',
    );
    expect(toTitleCase('Plan &amp; usage')).toBe('Plan &amp; Usage');
  });

  it('keeps acronyms and brand names, and handles phrasal verbs and hyphens', () => {
    expect(toTitleCase('AI settings')).toBe('AI Settings');
    expect(toTitleCase('VisaStack public beta')).toBe('VisaStack Public Beta');
    expect(toTitleCase('Sign in with the invited email')).toBe('Sign In with the Invited Email');
    expect(toTitleCase('Clean up dangling references')).toBe('Clean Up Dangling References');
    expect(toTitleCase('Legacy sign-in references')).toBe('Legacy Sign-In References');
    expect(toTitleCase('Monthly budget (USD, optional)')).toBe('Monthly Budget (USD, Optional)');
  });

  it('knows a term that is already right', () => {
    expect(isTitleCase('Visa Cases')).toBe(true);
    expect(isTitleCase('Visa cases')).toBe(false);
    // A capitalised small word is wrong; a single capital letter is not an abbreviation.
    expect(isTitleCase('Add A Traveller')).toBe(false);
    expect(toTitleCase('Plan vs. usage')).toBe('Plan vs. Usage');
  });
});

/*
 * Guard: every name in the interface uses Title Case. Two kinds of place hold names:
 *
 * - Term places (headings, legends, table headers, field labels, card titles, eyebrows): the
 *   text is judged a term unless it reads as a sentence or a statement ("Some sections could
 *   not be loaded"), because headings sometimes carry a short message.
 * - Name places (buttons, action links, menu and dropdown options, tabs, filters, summary tile
 *   labels, badges, consent names, and the label tables in lib/labels.ts and elsewhere): the
 *   text is a name unless it is a sentence (ending in a full stop, a question or a colon) or a
 *   statement with a verb ("Everything is working"). "Not Set Yet" is a name here. A leading
 *   "+ " or a trailing arrow is ignored before judging. A link inside a sentence is not a name.
 *
 * A miss from #251 that this closes: button and link text, option text, tile labels, values in
 * label tables, JSX fragments passed as titles, conditional text inside headings, and names
 * in the first person ("Let VisaStack Process My Details").
 */
const SRC = join(process.cwd(), 'src');
const TERM_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'legend',
  'th',
  'dt',
  'summary',
  'label',
  'caption',
]);
const NAME_TAGS = new Set(['button', 'option', 'optgroup', 'Link', 'a', 'StatusBadge']);
const TERM_CLASS = /\b(card-kicker|section-title|section-label|eyebrow|field-label|row-key)\b/;
/** Card titles are names even when they hold a verb ("You Are Up to Date", "Start a Case"). */
const TITLE_CLASS = /\b(card-title|empty-state-title)\b/;
/** Components whose title prop is a card title. */
const TITLE_COMPONENTS = new Set(['NextStepCard', 'EmptyState', 'Disclosure', 'Checklist']);
const NAME_CLASS =
  /(^|[\s"'`])(badge|pill|btn|tab|chip|[a-z0-9-]*-(label|kicker|metric|tab|filter|chip))(?=[\s"'`]|$)/;
const TERM_PROPS = new Set(['title', 'eyebrow', 'kicker', 'heading']);
const NAME_PROPS = new Set(['label', 'idle', 'busy', 'action', 'confirmLabel', 'cta']);
/** Tables of display names: every string value in them is a name. */
const NAME_TABLE = /(LABELS?|NAMES|_TITLES)$/;
const VERBS = 'could|would|should|cannot|is|are|was|were|has|have|had|will|may|might|does|did|can';
const STATEMENT = new RegExp(`\\b(${VERBS}|not)\\b`, 'i');
/** A sentence that opens with its subject ("We hit a snag", "Every visa starts with..."). */
const SUBJECT = /^(We|I|It|Nothing|Everything|Something|Every|There) /;
/** In a name place "Not" starts a name ("Not Set Yet"); a verb or a subject still makes a statement. */
const NAME_STATEMENT = new RegExp(`\\b(${VERBS})\\b`, 'i');

/** The text a person reads as the name, without a leading "+ " or a trailing arrow. */
function bare(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^\+\s*/, '')
    .replace(/\s*(→|->|›|»|↗|↓|↑)$/, '')
    .trim();
}

function looksLikeWords(text: string): boolean {
  const t = bare(text);
  if (t.length === 0 || t.length > 64 || /[.!?:;…,]$/.test(t) || /\.\s/.test(t)) return false;
  const words = t.split(' ');
  if (words.length < 2 || words.length > 10 || !/^[A-Z]/.test(t)) return false;
  return !/[{}<>=/\\@#$%]|https?:|\d{4}/.test(t);
}

function isName(text: string): boolean {
  const t = bare(text);
  return looksLikeWords(t) && !NAME_STATEMENT.test(t) && !SUBJECT.test(t);
}

function isCardTitle(text: string): boolean {
  return looksLikeWords(text);
}

function isTerm(text: string): boolean {
  const t = bare(text);
  if (!looksLikeWords(t) || t.split(' ').length > 8) return false;
  if (/^Loading /.test(t) || SUBJECT.test(t)) return false;
  // A question used as a heading is a name ("Who Has Access"); any other verb makes a statement.
  return /^(Who|What|Where|When|Why|How|Which) /.test(t) || !STATEMENT.test(t);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    const skipped =
      entry.name.includes('.test.') ||
      entry.name.includes('test-support') ||
      entry.name.endsWith('loading.tsx');
    return /\.tsx?$/.test(entry.name) && !skipped ? [path] : [];
  });
}

/** The plain strings an expression can produce: a literal, either side of a choice, or JSX text. */
function literals(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isJsxExpression(node) && node.expression) return literals(node.expression);
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node))
    return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  if (
    ts.isBinaryExpression(node) &&
    node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken
  )
    return literals(node.right);
  if (ts.isJsxFragment(node) || ts.isJsxElement(node)) {
    const parts = node.children.filter((c) => !ts.isJsxText(c) || c.text.trim());
    if (parts.length === 1 && parts[0] && ts.isJsxText(parts[0])) return [decode(parts[0].text)];
  }
  return [];
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&apos;|&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

function attribute(element: ts.JsxOpeningLikeElement, name: string): string {
  return (
    element.attributes.properties
      .filter(ts.isJsxAttribute)
      .find((a) => a.name.getText() === name)
      ?.initializer?.getText() ?? ''
  );
}

type Kind = 'title' | 'term' | 'name' | null;

/** Whether a node holds any words of its own (an icon does not). */
function hasWords(node: ts.Node): boolean {
  if (ts.isJsxText(node)) return /[A-Za-z]/.test(node.text);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return true;
  if (ts.isJsxAttributes(node)) return false;
  return node.getChildren().some(hasWords);
}

/** Whether an element's own text is a term, a name, or neither. */
function kindOf(element: ts.JsxElement): Kind {
  const opening = element.openingElement;
  const tag = opening.tagName.getText();
  const className = attribute(opening, 'className');
  // A link inside a sentence is part of the sentence ("Open them from your profile when...").
  const inSentence =
    ['Link', 'a'].includes(tag) &&
    ts.isJsxElement(element.parent) &&
    element.parent.children.some((c) => ts.isJsxText(c) && /[A-Za-z]/.test(c.text));
  if (inSentence) return null;
  if (TITLE_CLASS.test(className)) return 'title';
  if (NAME_TAGS.has(tag) || NAME_CLASS.test(className)) return 'name';
  if (TERM_TAGS.has(tag) || TERM_CLASS.test(className)) return 'term';
  // The label of a summary tile, tab or choice: the first span, strong or b inside a button, a
  // link or a choice's label. What follows it is the description or value.
  const parent = element.parent;
  if (['span', 'strong', 'b'].includes(tag) && ts.isJsxElement(parent)) {
    const outer = parent.openingElement.tagName.getText();
    const first = parent.children.find((c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c));
    const ownWords = parent.children.some((c) => ts.isJsxText(c) && /[A-Za-z]/.test(c.text));
    const choice = ['button', 'Link', 'a', 'label'].includes(outer) || tag === 'b';
    if (choice && first === element && !ownWords) return 'name';
  }
  return null;
}

/**
 * Every wording an element's text can show: its text pieces joined with each choice its
 * expressions can make ("Show {n === 1 ? 'it' : 'them'}" reads "Show it" or "Show them"). An
 * expression with no plain wording (a name from data) makes the text unknown, so it is skipped.
 */
function spoken(words: readonly (ts.JsxText | ts.JsxExpression)[]): string[] {
  let texts = [''];
  for (const word of words) {
    // A fallback after data ("{name ?? 'Unknown'}") is only part of the wording when it stands alone.
    const fallback =
      ts.isJsxExpression(word) &&
      word.expression !== undefined &&
      ts.isBinaryExpression(word.expression) &&
      words.length > 1;
    const choices = ts.isJsxText(word) ? [word.text] : fallback ? [] : literals(word);
    if (choices.length === 0 || texts.length * choices.length > 16) return [];
    texts = texts.flatMap((text) => choices.map((choice) => `${text}${choice}`));
  }
  return texts;
}

/** A title prop on a card component, or the title of a next step ({ title, action }). */
function isCardTitleProp(node: ts.PropertyAssignment | ts.JsxAttribute): boolean {
  if (ts.isJsxAttribute(node)) {
    const element = node.parent.parent;
    return TITLE_COMPONENTS.has(element.tagName.getText());
  }
  const object = node.parent;
  return (
    ts.isObjectLiteralExpression(object) &&
    object.properties.some((p) => p.name?.getText() === 'action')
  );
}

function offenders(file: string): string[] {
  if (file.endsWith('profile-fields.ts')) return [];
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const check = (node: ts.Node, text: string, kind: Kind) => {
    const shown = bare(decode(text));
    const judged =
      kind === 'title' ? isCardTitle(shown) : kind === 'name' ? isName(shown) : isTerm(shown);
    if (kind && judged && !isTitleCase(shown)) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${relative(SRC, file)}:${line + 1} "${shown}"`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const kind = kindOf(node);
      const parts = node.children.filter((c) => !ts.isJsxText(c) || c.text.trim());
      // Judge the element's own words when they are its whole text (an icon beside them is fine).
      const words = parts.filter(
        (c): c is ts.JsxText | ts.JsxExpression => ts.isJsxText(c) || ts.isJsxExpression(c),
      );
      const mixed = parts.some((c) => !ts.isJsxText(c) && !ts.isJsxExpression(c) && hasWords(c));
      const first = words[0];
      if (kind && !mixed && first) {
        for (const text of spoken(words)) check(first, text, kind);
      }
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isJsxAttribute(node)) &&
      node.initializer &&
      (TERM_PROPS.has(node.name.getText()) || NAME_PROPS.has(node.name.getText()))
    ) {
      const kind: Kind = NAME_PROPS.has(node.name.getText())
        ? 'name'
        : node.name.getText() === 'title' && isCardTitleProp(node)
          ? 'title'
          : 'term';
      for (const text of literals(node.initializer)) check(node, text, kind);
    }
    if (
      ts.isVariableDeclaration(node) &&
      NAME_TABLE.test(node.name.getText()) &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      for (const property of node.initializer.properties) {
        if (ts.isPropertyAssignment(property))
          for (const text of literals(property.initializer)) check(property, text, 'name');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('interface terms use Title Case', () => {
  it('has no heading, card title, field label, menu item, button, tile or tab name in sentence case', () => {
    const found = sourceFiles(SRC).flatMap(offenders);
    expect(
      found,
      `Write these as Title Case names (lib/title-case.ts):\n${found.join('\n')}`,
    ).toEqual([]);
  });

  it('names every consent in Title Case, as it reads on Home and in Privacy', () => {
    for (const { name } of Object.values(CONSENT_PLAIN)) expect(name).toBe(toTitleCase(name));
  });
});
