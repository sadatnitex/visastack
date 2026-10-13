import assert from 'node:assert/strict';
import test from 'node:test';
import { compare, measure } from './ui-ratchet.mjs';

test('counts inline style props and raw codes shown as page text', () => {
  const source = `export const A = ({ doc, m }) => (
    <div style={{ margin: 0 }}>
      <span style={{ gap: 4 }}>{doc.docType}</span>
      <b>{m.role}</b>
      <i title={m.role}>{label(m.role)}</i>
    </div>
  );`;
  assert.deepEqual(measure(source), { inlineStyles: 2, rawCodes: 2 });
});

test('a fixed class name and a plain label are not counted', () => {
  const source = 'export const A = ({ doc }) => <p className="note">{LABELS[doc.docType]}</p>;';
  assert.deepEqual(measure(source), { inlineStyles: 0, rawCodes: 0 });
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
