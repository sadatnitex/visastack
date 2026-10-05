import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 1.3.1, 3.3.2 and 4.1.2: every control a person fills in has a name that
 * assistive technology can read. A placeholder is not a name (it disappears when you
 * type and many screen readers skip it), so a control with only a placeholder fails.
 *
 * A control is named if it has `aria-label` or `aria-labelledby`, sits inside a
 * `<label>`, or has an `id` that a `<label htmlFor>` in the same file points at.
 * Hidden inputs and buttons need nothing.
 */

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));
const CONTROLS = new Set(['input', 'select', 'textarea']);
const NEEDS_NO_NAME = new Set(['hidden', 'submit', 'button', 'image', 'reset']);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsxFiles(full));
    else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) out.push(full);
  }
  return out;
}

interface Hit {
  readonly where: string;
  readonly code: string;
}

function unnamedControls(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

  // What every <label htmlFor> in the file points at (a string or an expression, as written).
  const labelled = new Set<string>();
  const collect = (node: ts.Node): void => {
    const element = ts.isJsxElement(node) ? node.openingElement : null;
    if (element && element.tagName.getText(sf) === 'label') {
      for (const attribute of element.attributes.properties) {
        if (ts.isJsxAttribute(attribute) && attribute.name.getText(sf) === 'htmlFor') {
          const value = attribute.initializer;
          if (value && ts.isStringLiteral(value)) labelled.add(value.text);
          else if (value && ts.isJsxExpression(value) && value.expression)
            labelled.add(value.expression.getText(sf));
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(sf);

  const hits: Hit[] = [];
  const visit = (node: ts.Node, insideLabel: boolean): void => {
    const isElement = ts.isJsxElement(node);
    const opening = isElement
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    const tag = opening?.tagName.getText(sf);
    const nowInsideLabel = insideLabel || tag === 'label';
    if (opening && tag && CONTROLS.has(tag)) {
      const attributes = opening.attributes.properties.filter(ts.isJsxAttribute);
      const named = (name: string) => attributes.find((a) => a.name.getText(sf) === name);
      const type = named('type')?.initializer;
      const typeText = type && ts.isStringLiteral(type) ? type.text : undefined;
      const idAttribute = named('id')?.initializer;
      const idText =
        idAttribute && ts.isStringLiteral(idAttribute)
          ? idAttribute.text
          : idAttribute && ts.isJsxExpression(idAttribute) && idAttribute.expression
            ? idAttribute.expression.getText(sf)
            : undefined;
      const hasName =
        named('aria-label') !== undefined ||
        named('aria-labelledby') !== undefined ||
        insideLabel ||
        (idText !== undefined && labelled.has(idText));
      if (!(typeText !== undefined && NEEDS_NO_NAME.has(typeText)) && !hasName) {
        const line = sf.getLineAndCharacterOfPosition(opening.getStart(sf)).line + 1;
        hits.push({
          where: `${relative(APP_DIR, file)}:${line}`,
          code: `<${tag}${typeText ? ` type="${typeText}"` : ''}>`,
        });
      }
    }
    ts.forEachChild(node, (child) => visit(child, nowInsideLabel));
  };
  visit(sf, false);
  return hits;
}

const files = tsxFiles(APP_DIR).map((file) => ({ file, source: readFileSync(file, 'utf8') }));

describe('the scanner itself', () => {
  const scan = (code: string) => unnamedControls('sample.tsx', code);

  it('finds a control with only a placeholder', () => {
    expect(scan('const a = <input name="q" placeholder="Search" />;')).toHaveLength(1);
    expect(scan('const a = <textarea name="note" placeholder="Note" />;')).toHaveLength(1);
    expect(scan('const a = <select name="s"><option>a</option></select>;')).toHaveLength(1);
  });

  it('accepts every way of naming a control', () => {
    expect(scan('const a = <input name="q" aria-label="Search" />;')).toEqual([]);
    expect(scan('const a = <input aria-labelledby="t" />;')).toEqual([]);
    expect(scan('const a = <label>Name <input name="n" /></label>;')).toEqual([]);
    expect(
      scan('const a = <><label htmlFor="n">Name</label><input id="n" name="n" /></>;'),
    ).toEqual([]);
    expect(
      scan('const a = <><label htmlFor={id}>Name</label><input id={id} name="n" /></>;'),
    ).toEqual([]);
  });

  it('needs nothing for hidden inputs and buttons', () => {
    expect(scan('const a = <input type="hidden" name="x" value="1" />;')).toEqual([]);
    expect(scan('const a = <input type="submit" value="Go" />;')).toEqual([]);
  });

  it('is not fooled by a label for a different control', () => {
    expect(
      scan('const a = <><label htmlFor="a">A</label><input id="b" name="b" /></>;'),
    ).toHaveLength(1);
  });
});

describe('every control has a name', () => {
  it('actually scans the forms it is meant to check', () => {
    expect(files.length).toBeGreaterThan(80);
    expect(files.some(({ source }) => source.includes('useActionState'))).toBe(true);
  });

  it('has no control that relies on a placeholder or nothing at all', () => {
    const hits = files.flatMap(({ file, source }) => unnamedControls(file, source));
    expect(hits.map((h) => `${h.where}  ${h.code}`)).toEqual([]);
  });
});
