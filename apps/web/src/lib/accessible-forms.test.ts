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
 * - a button disabled while an action runs or a check is under way (a disabled button
 *   drops keyboard focus to the top of the page): use `SubmitButton`, or `aria-disabled`
 *   and ignore the click while busy;
 * - a result paragraph that appears only after the action finishes (a screen reader
 *   often says nothing for text that arrives already in the page): use `FormMessage`.
 */

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));
const COMPONENTS_DIR = fileURLToPath(new URL('../components', import.meta.url));

/** Words that say a button is busy: `pending`, `loading`, `isLoading`, `savePending`, `saving`... */
const BUSY = /pending|loading|busy|submitting|running|saving|working/i;

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

/** Buttons of any kind whose `disabled` depends on something running. */
function disabledWhileBusy(file: string, source: string): Hit[] {
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
      const disabled = attributes.find((a) => a.name.getText(sf) === 'disabled');
      if (disabled?.initializer && BUSY.test(disabled.initializer.getText(sf))) {
        const line = sf.getLineAndCharacterOfPosition(element.getStart(sf)).line + 1;
        hits.push({ where: `${relative(APP_DIR, file)}:${line}`, code: disabled.getText(sf) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return hits;
}

const read = (file: string) => ({ file, source: readFileSync(file, 'utf8') });
const files = tsxFiles(APP_DIR).map(read);
const everyScreenFile = [...tsxFiles(APP_DIR), ...tsxFiles(COMPONENTS_DIR)].map(read);

describe('the scanner itself', () => {
  const scan = (code: string) => disabledWhileBusy('sample.tsx', code);

  it('finds a button disabled while an action runs or a check is under way, in any spelling', () => {
    expect(scan('const a = <button type="submit" disabled={pending}>Save</button>;')).toHaveLength(
      1,
    );
    expect(
      scan('const a = <button type="submit" disabled={pending || !ready}>Save</button>;'),
    ).toHaveLength(1);
    expect(scan('const a = <button type="submit" disabled={savePending} />;')).toHaveLength(1);
    // Not only submit buttons: a "Check now" button that re-runs a check was missed once.
    expect(
      scan('const a = <button type="button" disabled={loading}>Check now</button>;'),
    ).toHaveLength(1);
    expect(scan('const a = <button onClick={go} disabled={isLoading} />;')).toHaveLength(1);
  });

  it('leaves alone disabling for other reasons and buttons that stay focusable', () => {
    expect(scan('const a = <button type="submit" disabled={!ready}>Save</button>;')).toEqual([]);
    expect(scan('const a = <button type="submit" disabled={unavailable || undefined} />;')).toEqual(
      [],
    );
    expect(scan('const a = <input type="radio" disabled={pending} />;')).toEqual([]);
    expect(
      scan('const a = <button type="button" aria-disabled={loading || undefined}>Go</button>;'),
    ).toEqual([]);
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

  it('has no button that is disabled while something runs (use SubmitButton or aria-disabled)', () => {
    // The shared components and the status page are part of what is scanned, not only the forms.
    for (const name of ['form-feedback.tsx', 'status-view.tsx']) {
      expect(
        everyScreenFile.some(({ file }) => file.endsWith(name)),
        name,
      ).toBe(true);
    }
    const hits = everyScreenFile.flatMap(({ file, source }) => disabledWhileBusy(file, source));
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
