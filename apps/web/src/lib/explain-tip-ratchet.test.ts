import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * The plain `title=` hint is shown only to a mouse that rests on it: a touch screen and a keyboard
 * never see it, and screen readers treat it unevenly. The Explain popup (components/explain-tip.tsx)
 * replaces it. This counts `title` attributes on plain HTML elements (lowercase tags, so props of
 * our own components named `title`, such as `<Card>` or `<ui.Card>`, are not counted) in every non-test .tsx file under
 * apps/web/src. The ceiling is the count on 17 Nov 2026 (WP-PIC1) and can only go down: lower it
 * when a hint moves to ExplainTip, never raise it.
 */
const TITLE_ATTRIBUTE_CEILING = 6;

const SRC = join(__dirname, '..');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return path.endsWith('.tsx') && !path.endsWith('.test.tsx') ? [path] : [];
  });
}

/** Every plain `title` attribute in one file's text, as "file:line <tag>". */
function plainTitles(name: string, text: string): string[] {
  const source = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && node.name.getText(source) === 'title') {
      const tag = node.parent.parent.tagName.getText(source);
      if (/^[a-z][a-z0-9-]*$/.test(tag)) {
        const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
        found.push(`${name}:${line} <${tag}>`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

describe('plain title= hints only go down', () => {
  const all = files(SRC).flatMap((path) =>
    plainTitles(relative(SRC, path), readFileSync(path, 'utf8')),
  );

  it(`counts at most ${TITLE_ATTRIBUTE_CEILING} plain title attributes`, () => {
    expect(all.length, all.join('\n')).toBeLessThanOrEqual(TITLE_ATTRIBUTE_CEILING);
  });

  it('counts plain elements and not our own components (the counter itself works)', () => {
    const sample = [
      'const a = <span title="x">A</span>;',
      'const b = <Card title="y" />;',
      'const c = <button type="button" title={hint}>C</button>;',
      'const d = <ui.Thing title="z" />;',
    ].join('\n');
    expect(plainTitles('sample.tsx', sample)).toEqual([
      'sample.tsx:1 <span>',
      'sample.tsx:3 <button>',
    ]);
  });
});
