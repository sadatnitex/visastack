import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Owner list item 13: every icon-only link and button has a name a screen reader can say. A
 * control whose only content is a drawing (an `Icon`, an `svg`, the brand mark, an avatar, a
 * progress ring or something marked `aria-hidden`) needs `aria-label`, `aria-labelledby` or a
 * `title`; otherwise a screen reader announces just "button" or "link". Words written in the
 * control (even screen-reader-only words) count as a name. A value computed at run time (`{x}`)
 * is assumed to be words, so this guard never cries wolf; the rendered checks in
 * `app/app/staff-mode.test.tsx` and the browser scans in `e2e/ux-public.spec.ts` cover those.
 */
const SRC = join(__dirname, '..');
const CONTROLS = new Set(['a', 'button', 'Link', 'summary']);
const NAMES = new Set(['aria-label', 'aria-labelledby', 'title']);
/** Drawings: they show something but say nothing. */
const DRAWINGS = new Set([
  'Icon',
  'svg',
  'BrandMark',
  'PersonAvatar',
  'ProgressRing',
  'CaseReadinessRing',
]);

function attributeNames(attributes: ts.JsxAttributes, sf: ts.SourceFile): string[] {
  return attributes.properties
    .filter(ts.isJsxAttribute)
    .map((attribute) => attribute.name.getText(sf));
}

function spreads(attributes: ts.JsxAttributes): boolean {
  return attributes.properties.some(ts.isJsxSpreadAttribute);
}

/** Whether these children put any words in the control. */
function saysSomething(children: ts.NodeArray<ts.JsxChild>, sf: ts.SourceFile): boolean {
  for (const child of children) {
    if (ts.isJsxText(child)) {
      if (child.text.trim()) return true;
    } else if (ts.isJsxExpression(child)) {
      if (child.expression) return true;
    } else if (ts.isJsxSelfClosingElement(child)) {
      const tag = child.tagName.getText(sf);
      const names = attributeNames(child.attributes, sf);
      if (tag === 'img' ? names.includes('alt') : !DRAWINGS.has(tag)) return true;
    } else if (ts.isJsxElement(child)) {
      const open = child.openingElement;
      if (open.tagName.getText(sf) === 'svg') continue;
      if (attributeNames(open.attributes, sf).includes('aria-hidden')) continue;
      if (saysSomething(child.children, sf)) return true;
    } else if (ts.isJsxFragment(child)) {
      if (saysSomething(child.children, sf)) return true;
    }
  }
  return false;
}

/** Every icon-only control without a name in one file's source, as "file:line <tag>". */
function unnamedIconControls(source: string, file = 'component.tsx'): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  const where = (node: ts.Node) =>
    `${file}:${sf.getLineAndCharacterOfPosition(node.getStart()).line + 1}`;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node)) {
      const open = node.openingElement;
      const tag = open.tagName.getText(sf);
      if (
        CONTROLS.has(tag) &&
        !spreads(open.attributes) &&
        !attributeNames(open.attributes, sf).some((name) => NAMES.has(name)) &&
        !saysSomething(node.children, sf)
      )
        found.push(`${where(node)} <${tag}>`);
    } else if (ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(sf);
      if (
        CONTROLS.has(tag) &&
        !spreads(node.attributes) &&
        !attributeNames(node.attributes, sf).some((name) => NAMES.has(name))
      )
        found.push(`${where(node)} <${tag} />`);
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (entry.name.endsWith('.tsx') && !entry.name.includes('.test')) out.push(full);
  }
  return out;
}

describe('icon-only links and buttons have a name (owner list item 13)', () => {
  it('finds none without a name anywhere in the product, public pages and the signed-in app', () => {
    const files = sourceFiles(SRC);
    // The scan really reads the product: the shell, the toolbar and the public notice are in it.
    expect(files.length).toBeGreaterThan(200);
    const missing = files.flatMap((file) =>
      unnamedIconControls(readFileSync(file, 'utf8'), relative(SRC, file)),
    );
    expect(missing).toEqual([]);
  });

  it('catches the mistake it guards against, and accepts each way of naming a control', () => {
    expect(
      unnamedIconControls(
        '<button type="button"><Icon name="close" /></button>;\n<Link href="/x"><svg /></Link>;\n<a href="/y" />;',
      ),
    ).toEqual(['component.tsx:1 <button>', 'component.tsx:2 <Link>', 'component.tsx:3 <a />']);
    expect(
      unnamedIconControls(
        [
          '<button aria-label="Close"><Icon name="close" /></button>;',
          '<button aria-labelledby="x"><Icon name="close" /></button>;',
          '<a href="/" title="Home"><BrandMark /></a>;',
          '<button><Icon name="close" /> Close</button>;',
          '<button><Icon name="close" /><span className="sr-only">Close</span></button>;',
          '<Link href="/x">{label}</Link>;',
          '<a href="/"><img alt="Home" src="/h.png" /></a>;',
        ].join('\n'),
      ),
    ).toEqual([]);
    // Words hidden from screen readers are no name.
    expect(
      unnamedIconControls(
        '<button><span aria-hidden="true">x</span><Icon name="close" /></button>;',
      ),
    ).toEqual(['component.tsx:1 <button>']);
  });
});
