import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DETAILS_HOME, compare, measure, measureTree } from './ui-ratchet.mjs';

test('counts inline style props and raw codes shown as page text', () => {
  const source = `export const A = ({ doc, m }) => (
    <div style={{ margin: 0 }}>
      <span style={{ gap: 4 }}>{doc.docType}</span>
      <b>{m.role}</b>
      <i title={m.role}>{label(m.role)}</i>
    </div>
  );`;
  assert.deepEqual(measure(source), { inlineStyles: 2, rawCodes: 2, emDashes: 0, folds: 0 });
});

test('a fixed class name and a plain label are not counted', () => {
  const source = 'export const A = ({ doc }) => <p className="note">{LABELS[doc.docType]}</p>;';
  assert.deepEqual(measure(source), { inlineStyles: 0, rawCodes: 0, emDashes: 0, folds: 0 });
});

test('fails when a file gains an inline style or a raw code, or a new file has any', () => {
  const baseline = { inlineStyles: { 'a.tsx': 2 }, rawCodes: { 'a.tsx': 1 } };
  assert.equal(
    compare({ inlineStyles: { 'a.tsx': 2 }, rawCodes: { 'a.tsx': 1 } }, baseline).length,
    0,
  );
  assert.equal(compare({ inlineStyles: { 'a.tsx': 1 }, rawCodes: {} }, baseline).length, 0);
  assert.equal(
    compare({ inlineStyles: { 'a.tsx': 3 }, rawCodes: { 'a.tsx': 1 } }, baseline).length,
    1,
  );
  assert.equal(compare({ inlineStyles: { 'b.tsx': 1 }, rawCodes: {} }, baseline).length, 1);
  assert.equal(compare({ inlineStyles: {}, rawCodes: { 'a.tsx': 2 } }, baseline).length, 1);
});

test('counts a long dash in page text and in strings, but not in a comment', () => {
  const dash = String.fromCharCode(0x2014);
  const source = `// note ${dash} ignored
export const A = () => <p title="a ${dash} b">Visit ${dash} then go {'x ${dash} y'}</p>;`;
  assert.equal(measure(source).emDashes, 3);
  assert.equal(
    compare(
      { inlineStyles: {}, rawCodes: {}, emDashes: { 'a.tsx': 1 } },
      { inlineStyles: {}, rawCodes: {} },
    ).length,
    1,
  );
});

test('counts raw details elements, opening tags only, in any nesting', () => {
  const source = `export const A = ({ open }) => (
    <section>
      <details open={open}><summary>One</summary>
        <details className="inner"><summary>Two</summary></details>
      </details>
      <p>details are words here, not an element</p>
    </section>
  );`;
  assert.equal(measure(source).folds, 2);
  assert.equal(measure('export const B = () => <details />;').folds, 1);
});

test('counts the older shared folds too, so a screen cannot slip past through them', () => {
  const source = `export const A = () => (
    <>
      <Disclosure title="A">x</Disclosure>
      <AboutDisclosure summary="B">y</AboutDisclosure>
      <CollapsibleGroup title="C">z</CollapsibleGroup>
      <CollapsibleGroups groups={[]} />
      <StickyDetails initiallyOpen summary="D">w</StickyDetails>
      <ExpandableSection title="E">v</ExpandableSection>
    </>
  );`;
  assert.equal(measure(source).folds, 5);
});

test('fails when a file gains a raw details element, or a new file has one', () => {
  const baseline = { inlineStyles: {}, rawCodes: {}, folds: { 'a.tsx': 2 } };
  const now = (folds) => ({ inlineStyles: {}, rawCodes: {}, folds });
  assert.equal(compare(now({ 'a.tsx': 2 }), baseline).length, 0);
  assert.equal(compare(now({ 'a.tsx': 1 }), baseline).length, 0);
  assert.equal(compare(now({ 'a.tsx': 3 }), baseline).length, 1);
  assert.equal(compare(now({ 'b.tsx': 1 }), baseline).length, 1);
  assert.match(compare(now({ 'b.tsx': 1 }), baseline)[0], /ExpandableSection/);
});

test('the shared Expandable Section and test files are not counted; other files are', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-ratchet-'));
  try {
    const src = join(root, 'apps/web/src');
    const home = join(root, DETAILS_HOME);
    mkdirSync(join(src, 'screens'), { recursive: true });
    mkdirSync(join(home, '..'), { recursive: true });
    const one = 'export const A = () => <details><summary>A</summary></details>;';
    writeFileSync(home, one);
    writeFileSync(join(src, 'screens/a.test.tsx'), one);
    writeFileSync(join(src, 'screens/b.tsx'), one);
    assert.deepEqual(measureTree(root).folds, { 'apps/web/src/screens/b.tsx': 1 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a fold cannot slip past by a dotted name, a renamed import or createElement', () => {
  const dotted = 'export const A = () => <ui.Disclosure title="A">x</ui.Disclosure>;';
  assert.equal(measure(dotted).folds, 1);
  const renamed = `import { Disclosure as Fold2, StickyDetails as Keep } from './ui';
export const A = () => (<><Fold2 title="A">x</Fold2><Keep initiallyOpen summary="B">y</Keep></>);`;
  assert.equal(measure(renamed).folds, 2);
  const created = `import { createElement } from 'react';
import * as React from 'react';
export const A = () => createElement('details', null, createElement('summary', null, 'A'));
export const B = () => React.createElement(Disclosure, { title: 'B' });
export const C = () => createElement('section', null);`;
  assert.equal(measure(created, 'plain.ts').folds, 2);
});

test('the case, collect and readiness folds are counted', () => {
  const source = `export const A = () => (
    <>
      <RailFold title="A">x</RailFold>
      <Fold title="B">y</Fold>
      <ReadinessLegendFold segments={[]} />
      <LazyDisclosure title="C">z</LazyDisclosure>
    </>
  );`;
  assert.equal(measure(source).folds, 4);
});

test('.ts files are walked for folds (createElement), and only for folds', () => {
  const root = mkdtempSync(join(tmpdir(), 'ui-ratchet-ts-'));
  try {
    const src = join(root, 'apps/web/src/lib');
    mkdirSync(src, { recursive: true });
    writeFileSync(
      join(src, 'make.ts'),
      `import { createElement } from 'react';\nexport const fold = () => createElement('details', null);\nexport const words = 'a ${String.fromCharCode(0x2014)} b';\n`,
    );
    const counts = measureTree(root);
    assert.deepEqual(counts.folds, { 'apps/web/src/lib/make.ts': 1 });
    assert.deepEqual(counts.emDashes, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/*
 * The recorded totals. The baseline may only go down by `--lower`; raising any number here or in
 * scripts/ui-ratchet.baseline.json needs the Guardian's approval written in the pull request.
 * When a count goes down, lower both this table and the baseline in the same change.
 */
const PINNED_TOTALS = { inlineStyles: 290, rawCodes: 0, emDashes: 0, folds: 190 };

test('the baseline totals are pinned, so the baseline cannot be raised quietly', () => {
  const baseline = JSON.parse(
    readFileSync(new URL('./ui-ratchet.baseline.json', import.meta.url), 'utf8'),
  );
  const sum = (map) => Object.values(map ?? {}).reduce((a, b) => a + b, 0);
  for (const [key, total] of Object.entries(PINNED_TOTALS)) {
    assert.equal(sum(baseline[key]), total, `${key} total in ui-ratchet.baseline.json`);
  }
});
