import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
