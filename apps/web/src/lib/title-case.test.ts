import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';
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
 * Guard: every heading, card title, field label, menu item and short button name in the
 * interface is a term and uses Title Case. Sentences (ending in a full stop, a question or a
 * colon), prompts ("Choose a role…"), first-person phrases ("Let VisaStack process my
 * details") and statements ("Some sections could not be loaded") are left alone.
 */
const SRC = join(process.cwd(), 'src');
const TERM_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'legend', 'th', 'dt', 'summary', 'label']);
const TERM_CLASS = /\b(card-title|card-kicker|section-title|eyebrow|field-label|row-key|badge)\b/;
const TERM_PROPS = new Set(['label', 'idle', 'title', 'eyebrow']);
const STATEMENT =
  /\b(could|would|should|cannot|not|is|are|was|were|has|have|had|will|may|might|does|did|can)\b/i;

function isTerm(text: string): boolean {
  const t = text.trim();
  if (t.length === 0 || t.length > 48 || /[.!?:;…]$/.test(t) || /\.\s/.test(t)) return false;
  const words = t.split(/\s+/);
  if (words.length < 2 || words.length > 6 || !/^[A-Z]/.test(t)) return false;
  if (/[{}<>=/\\@]|https?:/.test(t)) return false;
  if (/^(Loading|Choose|Select|Pick|Search) /.test(t) || STATEMENT.test(t)) return false;
  return !/\s(my|I)\s|\smy$/.test(t);
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(entry.name) && !/\.test\.|test-support|loading\.tsx$/.test(entry.name)
      ? [path]
      : [];
  });
}

/** The plain strings an expression can produce: a literal, or either side of a choice. */
function literals(node: ts.Node): string[] {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return [node.text];
  if (ts.isJsxExpression(node) && node.expression) return literals(node.expression);
  if (ts.isParenthesizedExpression(node)) return literals(node.expression);
  if (ts.isConditionalExpression(node))
    return [...literals(node.whenTrue), ...literals(node.whenFalse)];
  return [];
}

function offenders(file: string): string[] {
  if (file.endsWith('profile-fields.ts')) return [];
  const sf = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const found: string[] = [];
  const check = (node: ts.Node, text: string) => {
    if (isTerm(text) && !isTitleCase(text.trim().replace(/\s+/g, ' '))) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${relative(SRC, file)}:${line + 1} "${text.trim()}"`);
    }
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxText(node) && ts.isJsxElement(node.parent)) {
      const opening = node.parent.openingElement;
      const tag = opening.tagName.getText();
      const className = opening.attributes.properties
        .filter(ts.isJsxAttribute)
        .find((a) => a.name.getText() === 'className')
        ?.initializer?.getText();
      const only =
        node.parent.children.filter((c) => !ts.isJsxText(c) || c.getText().trim()).length === 1;
      if (only && (TERM_TAGS.has(tag) || TERM_CLASS.test(className ?? '')))
        check(node, node.getText());
    }
    if (
      (ts.isPropertyAssignment(node) || ts.isJsxAttribute(node)) &&
      TERM_PROPS.has(node.name.getText()) &&
      node.initializer
    ) {
      for (const text of literals(node.initializer)) check(node, text);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('interface terms use Title Case', () => {
  it('has no heading, card title, field label, menu item or button name in sentence case', () => {
    const found = sourceFiles(SRC).flatMap(offenders);
    expect(
      found,
      `Write these as Title Case terms (lib/title-case.ts):\n${found.join('\n')}`,
    ).toEqual([]);
  });
});
