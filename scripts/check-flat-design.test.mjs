import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkCss, checkInline } from './check-flat-design.mjs';

test('rejects effects hidden in variables and nested media rules', () => {
  for (const css of [
    '.card { box-shadow: var(--depth) }',
    ':root { --surface: radial-gradient(red, white) }',
    '@media (width > 960px) { .nav { backdrop-filter: blur(8px) } }',
  ])
    assert.ok(checkCss(css).length > 0);
});
test('rejects translucent material surfaces and inline effects', () => {
  assert.ok(checkCss('.nav { background: rgb(255 255 255 / 50%) }').length > 0);
  assert.ok(checkInline('<div style={{ boxShadow: "var(--depth)" }} />').length > 0);
  assert.ok(
    checkInline('<div style={{ background: "linear-gradient(red, white)" }} />').length > 0,
  );
});
test('preserves outlines, legitimate progress and inert comments', () => {
  assert.deepEqual(
    checkCss(
      '/* box-shadow: bad */ .progress { background: conic-gradient(teal 50%, white 0); outline: 3px solid teal; box-shadow: none }',
    ),
    [],
  );
  assert.deepEqual(
    checkInline('// boxShadow: fake\n<div className="shadow-history" style={{ width: "50%" }} />'),
    [],
  );
});
