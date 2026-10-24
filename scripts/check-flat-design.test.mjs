import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  checkCss,
  checkInline,
  checkStylesheet,
  LANDING_EFFECTS_EXCEPTION,
} from './check-flat-design.mjs';

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

test('rejects automatic dark substitution while allowing designed navy surfaces', () => {
  assert.ok(checkCss('@media (prefers-color-scheme: dark) { :root { --bg: #102937 } }').length > 0);
  assert.deepEqual(checkCss('.intentional-accent { background: #102937; color: #ffffff }'), []);
});

test('allows Harbor effects only in the one landing stylesheet (owner decision D1)', () => {
  const effects =
    '.phone { box-shadow: 0 42px 90px #0002 } .feature { background: radial-gradient(circle, #1d4c98 0, transparent 47%) } .glass { background: rgba(255, 255, 255, 0.5) }';
  assert.deepEqual(checkStylesheet(effects, LANDING_EFFECTS_EXCEPTION), []);
  for (const elsewhere of [
    'apps/web/src/app/globals.css',
    'apps/web/src/app/other/landing-c1.css',
    'apps/web/src/app/landing-c1.css.bak',
    'apps/web/src/components/landing-c1.css',
  ])
    assert.ok(checkStylesheet(effects, elsewhere).length >= 3, elsewhere);
});

test('the landing exception never allows automatic dark appearance', () => {
  assert.ok(
    checkStylesheet(
      '@media (prefers-color-scheme: dark) { .c1 { background: #000 } }',
      LANDING_EFFECTS_EXCEPTION,
    ).length > 0,
  );
});
