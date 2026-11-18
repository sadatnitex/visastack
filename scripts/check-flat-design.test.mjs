import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EFFECTS_EXCEPTIONS,
  checkCss,
  checkInline,
  checkStylesheet,
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

test('allows effects only in the listed depth stylesheets, never in a look-alike path', () => {
  const effects =
    '.phone { box-shadow: 0 42px 90px #0002 } .feature { background: radial-gradient(circle, #1d4c98 0, transparent 47%) } .glass { background: rgba(255, 255, 255, 0.5) }';
  assert.deepEqual(checkStylesheet(effects, PICTURES_DEPTH), []);
  for (const elsewhere of [
    'apps/web/src/app/globals.css',
    'apps/web/src/app/other/pictures-depth.css',
    'apps/web/src/components/pictures/pictures-depth.css.bak',
    'apps/web/src/app/landing-c1.css',
  ])
    assert.ok(checkStylesheet(effects, elsewhere).length >= 3, elsewhere);
});

test('an exempt stylesheet never allows automatic dark appearance', () => {
  assert.ok(
    checkStylesheet(
      '@media (prefers-color-scheme: dark) { .c1 { background: #000 } }',
      PICTURES_DEPTH,
    ).length > 0,
  );
});

// ADR 0027 (owner decision D2, 17 Nov 2026): visual depth for illustrations and hero cards.
const PICTURES_DEPTH = 'apps/web/src/components/pictures/pictures-depth.css';
// ADR 0029 (amends ADR 0027, owner decision 17 Nov 2026): ONE depth stylesheet for the public
// site's scroll scenes. An approved guard correction: the list grows from two entries to three.
const PUBLIC_SCENES = 'apps/web/src/components/public-site/public-scenes.css';

test('the exception list names exactly the picture and public scene stylesheets (ADR 0027, ADR 0029)', () => {
  assert.deepEqual(EFFECTS_EXCEPTIONS, [PICTURES_DEPTH, PUBLIC_SCENES]);
  assert.ok(Object.isFrozen(EFFECTS_EXCEPTIONS));
});

test('allows soft shadows, glow and blur in each exempt stylesheet only (ADR 0027)', () => {
  const depth =
    '.hero-picture { box-shadow: 0 24px 48px #0f2a4a1f } .hero-glow { background: radial-gradient(circle, #1d4c98 0, transparent 60%); filter: blur(24px) } .veil { background: rgba(255, 255, 255, 0.5) }';
  for (const exempt of EFFECTS_EXCEPTIONS)
    assert.deepEqual(checkStylesheet(depth, exempt), [], exempt);
  for (const elsewhere of [
    'apps/web/src/app/globals.css',
    'apps/web/src/components/pictures/pictures-other.css',
    'apps/web/src/components/pictures/nested/pictures-depth.css',
    'apps/web/src/components/pictures-depth.css',
    'apps/web/src/components/pictures/pictures-depth.css.bak',
    'apps/web/src/components/Pictures/pictures-depth.css',
    'apps/web/src/components/public-site/public-site.css',
    'apps/web/src/components/public-site/public-scenes.css.bak',
    'apps/web/src/components/public-site/nested/public-scenes.css',
    'apps/web/src/components/public-scenes.css',
  ])
    assert.ok(checkStylesheet(depth, elsewhere).length >= 3, elsewhere);
  assert.deepEqual(checkStylesheet(depth, PICTURES_DEPTH.split('/').join('\\')), []);
});

test('no exempt stylesheet may switch to automatic dark appearance (ADR 0027)', () => {
  for (const exempt of EFFECTS_EXCEPTIONS)
    assert.ok(
      checkStylesheet(
        '@media (prefers-color-scheme: dark) { .hero-picture { background: #000 } }',
        exempt,
      ).length > 0,
      exempt,
    );
});

test('inline effects in components stay forbidden, pictures included (ADR 0027)', () => {
  assert.ok(
    checkInline(
      '<div style={{ boxShadow: "0 24px 48px #0002" }} />',
      'apps/web/src/components/pictures/passport-cover.tsx',
    ).length > 0,
  );
  assert.ok(
    checkInline(
      '<div style={{ filter: "blur(12px)" }} />',
      'apps/web/src/components/pictures/hero-glow.tsx',
    ).length > 0,
  );
});
