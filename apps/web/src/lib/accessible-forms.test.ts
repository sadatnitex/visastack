import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Forms must tell everyone what happened (WCAG 3.3.1, 4.1.3) and must not lose a
 * keyboard user's place while an action runs (WCAG 2.4.3). The shared pieces in
 * `components/form-feedback.tsx` do that; this guard fails when a form goes back to the
 * patterns they replaced:
 *
 * - a submit button disabled while an action runs (a disabled button drops keyboard
 *   focus to the top of the page): use `SubmitButton`;
 * - a result paragraph that appears only after the action finishes (a screen reader
 *   often says nothing for text that arrives already in the page): use `FormMessage`.
 */

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));

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

/** Submit buttons whose `disabled` depends on an action running. */
function disabledWhilePending(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const hits: Hit[] = [];
  const visit = (node: ts.Node): void => {
    const element = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;
    if (element && element.tagName.getText(sf) === 'button') {
      const attributes = element.attributes.properties.filter(ts.isJsxAttribute);
      const isSubmit = attributes.some(
        (a) =>
          a.name.getText(sf) === 'type' &&
          a.initializer !== undefined &&
          ts.isStringLiteral(a.initializer) &&
          a.initializer.text === 'submit',
      );
      const disabled = attributes.find((a) => a.name.getText(sf) === 'disabled');
      if (isSubmit && disabled?.initializer && /pending/i.test(disabled.initializer.getText(sf))) {
        const line = sf.getLineAndCharacterOfPosition(element.getStart(sf)).line + 1;
        hits.push({ where: `${relative(APP_DIR, file)}:${line}`, code: disabled.getText(sf) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const files = tsxFiles(APP_DIR).map((file) => ({ file, source: readFileSync(file, 'utf8') }));

describe('the scanner itself', () => {
  const scan = (code: string) => disabledWhilePending('sample.tsx', code);

  it('finds a submit button disabled while an action runs, in either spelling', () => {
    expect(scan('const a = <button type="submit" disabled={pending}>Save</button>;')).toHaveLength(
      1,
    );
    expect(
      scan('const a = <button type="submit" disabled={pending || !ready}>Save</button>;'),
    ).toHaveLength(1);
    expect(scan('const a = <button type="submit" disabled={savePending} />;')).toHaveLength(1);
  });

  it('leaves alone buttons that are not submit buttons and disabling for other reasons', () => {
    expect(scan('const a = <button type="button" disabled={pending}>Open</button>;')).toEqual([]);
    expect(scan('const a = <button type="submit" disabled={!ready}>Save</button>;')).toEqual([]);
    expect(scan('const a = <SubmitButton pending={pending} idle="Save" busy="Saving" />;')).toEqual(
      [],
    );
  });
});

describe('forms tell everyone what happened', () => {
  it('actually scans the forms it is meant to check', () => {
    const forms = files.filter(({ source }) => source.includes('useActionState'));
    expect(forms.length).toBeGreaterThan(40);
  });

  it('has no submit button that is disabled while an action runs (use SubmitButton)', () => {
    const hits = files.flatMap(({ file, source }) => disabledWhilePending(file, source));
    expect(hits.map((h) => `${h.where}: ${h.code}`)).toEqual([]);
  });

  it('has no result paragraph that appears only after the action finishes (use FormMessage)', () => {
    const hits = files
      .filter(({ source }) => /\b(\w*[sS]tate|result)\.message \? \(\s*<(p|span)/.test(source))
      .map(({ file }) => relative(APP_DIR, file));
    expect(hits).toEqual([]);
  });

  it('gives every form that reports a result a FormMessage', () => {
    const missing = files
      .filter(
        ({ source }) => /useActionState/.test(source) && /state\.message|\.message\b/.test(source),
      )
      .filter(({ source }) => !source.includes('FormMessage'))
      .map(({ file }) => relative(APP_DIR, file));
    expect(missing, missing.join('\n')).toEqual([]);
  });
});
