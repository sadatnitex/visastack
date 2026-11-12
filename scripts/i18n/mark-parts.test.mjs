import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, test } from 'node:test';
import { markSource, runMarkParts } from './mark-parts.mjs';

const HEAD = `import { getServerT } from '../lib/i18n-server';\nimport { useT } from '../components/i18n-provider';\n`;
const mark = (body) => markSource(`${HEAD}${body}`, 'fixture.tsx');
const roots = [];
after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe('text children', () => {
  test('a plain call in a child becomes t.node, with its parameters', () => {
    const r = mark(
      `export function A() {\n  const t = getServerT(c);\n  return <p>{t('a.one')} {t('a.two', { n: 3 })}</p>;\n}\n`,
    );
    assert.match(r.code, /\{t\.node\('a\.one'\)\}/);
    assert.match(r.code, /\{t\.node\('a\.two', \{ n: 3 \}\)\}/);
    assert.equal(r.tally.nodes, 2);
  });

  test('works through a conditional, && and ??, and on a client translator and an awaited one', () => {
    const r = mark(
      `export function A({ x }) {\n  const t = useT(c);\n  return <p>{x ? t('a.yes') : t('a.no')}{x && t('a.and')}{x ?? t('a.nullish')}</p>;\n}\n` +
        `export async function B() {\n  const t = await getT(c);\n  return <p>{t('b.one')}</p>;\n}\n`,
    );
    for (const k of ['a.yes', 'a.no', 'a.and', 'a.nullish', 'b.one'])
      assert.match(r.code, new RegExp(`t\\.node\\('${k.replace('.', '\\.')}'\\)`));
    assert.equal(r.tally.nodes, 5);
  });

  test('template literals, component props and stored values stay a plain t()', () => {
    const r = mark(
      `export function A() {\n  const t = getServerT(c);\n  const label = t('a.stored');\n  return <Card heading={t('a.prop')} caption={\`\${t('a.tpl')} x\`}>{label}</Card>;\n}\n`,
    );
    assert.equal(r.changed, false);
    assert.deepEqual(r.tally.plain, { value_flow: 1, component_prop: 1, template_literal: 1 });
  });

  test('a different t (a parameter, the legacy translator) is left alone', () => {
    const r = mark(
      `export function A({ rows }) {\n  const t = createTranslator('en');\n  return <ul>{rows.map((t) => <li>{t('x')}</li>)}<p>{t('y')}</p></ul>;\n}\n`,
    );
    assert.equal(r.changed, false);
  });

  test('a translator passed in and typed PartsTranslator is recognised', () => {
    const r = mark(
      `export function A(t: PartsTranslator<K>) {\n  return <p>{t('a.one')}</p>;\n}\n`,
    );
    assert.match(r.code, /t\.node\('a\.one'\)/);
  });
});

describe('attributes', () => {
  test('aria-label, title and alt on a host element with no words of its own get a lang spread', () => {
    const r = mark(
      'export function A() {\n  const t = getServerT(c);\n  return <><nav aria-label={t(\'a.nav\')}><a href="/x" /><Icon name="x" /></nav><img alt={t(\'a.alt\')} src="/i.png" /><div title={t(\'a.title\')} /><Link href="/" aria-label={t(\'a.link\')} /></>;\n}\n',
    );
    for (const k of ['a.nav', 'a.alt', 'a.title', 'a.link'])
      assert.ok(r.code.includes(`{...t.lang('${k}')}`), k);
    assert.equal(r.tally.langAttrs, 4);
  });

  test('a form control is skipped: its lang would also name what the person types', () => {
    const r = mark(
      "export function A() {\n  const t = getServerT(c);\n  return <><input placeholder={t('a.ph')} /><select aria-label={t('a.s')} /></>;\n}\n",
    );
    assert.equal(r.changed, false);
    assert.equal(r.tally.skipped.form_control, 2);
  });

  test('two attributes with the same key share one spread', () => {
    const r = mark(
      `export function A() {\n  const t = getServerT(c);\n  return <button aria-label={t('a.k')} title={t('a.k')} />;\n}\n`,
    );
    assert.equal(r.code.match(/t\.lang\(/g)?.length, 1);
  });

  test('skipped as attribute_lang_mixed: other text inside, two keys, hard-coded words', () => {
    const r = mark(
      'export function A() {\n  const t = getServerT(c);\n  return <>' +
        `<nav aria-label={t('a.nav')}><a>{t('a.link')}</a></nav>` +
        `<button aria-label={t('a.x')} title={t('a.y')} />` +
        `<p title={t('a.z')}>Hello</p>` +
        `<ul aria-label={t('a.l')}><li input={0} placeholder={t('a.deep')} /></ul>` +
        '</>;\n}\n',
    );
    // Only the innermost element (its own message, nothing else inside) is marked.
    assert.equal(r.tally.langAttrs, 1);
    assert.equal(r.code.match(/t\.lang\(/g)?.length, 1);
    assert.ok(r.code.includes(`{...t.lang('a.deep')}`));
    assert.equal(r.tally.skipped.attribute_lang_mixed, 5);
  });

  test('the same key in a child is fine; variables, map output and unknown components are not', () => {
    const r = mark(
      "export function A({ name, rows }) {\n  const t = getServerT(c);\n  return <><a aria-label={t('a.k')}>{t('a.k')}</a><b title={t('a.m')}>{name}</b><ul aria-label={t('a.l')}>{rows.map((x) => x)}</ul><p title={t('a.c')}><Card /></p></>;\n}\n",
    );
    assert.ok(r.code.includes(`{...t.lang('a.k')}`));
    assert.equal(r.tally.langAttrs, 1);
    assert.equal(r.tally.skipped.attribute_lang_mixed, 3);
  });

  test('a component prop named title is not an element attribute', () => {
    const r = mark(
      `export function A() {\n  const t = getServerT(c);\n  return <Shell title={t('a.t')} aria-label={t('a.l')} />;\n}\n`,
    );
    assert.equal(r.changed, false);
    assert.equal(r.tally.plain.component_prop, 2);
  });

  test('an element that already says its language is left alone', () => {
    const r = mark(
      `export function A() {\n  const t = getServerT(c);\n  return <><p lang="en" title={t('a.t')} /><p {...t.lang('a.t')} title={t('a.t')} /></>;\n}\n`,
    );
    assert.equal(r.changed, false);
  });
});

describe('elements that cannot hold a span', () => {
  test('an option with only the message gets lang on the option', () => {
    const r = mark(
      `export function A() {\n  const t = getServerT(c);\n  return <select><option value="a">{t('a.opt')}</option></select>;\n}\n`,
    );
    assert.match(
      r.code,
      /<option \{\.\.\.t\.lang\('a\.opt'\)\} value="a">\{t\('a\.opt'\)\}<\/option>/,
    );
    assert.equal(r.tally.optionLangs, 1);
    assert.equal(r.tally.nodes, 0);
  });

  test('an option whose text switches between two messages is reported, not given two langs', () => {
    const r = mark(
      "export function A({ x }) {\n  const t = getServerT(c);\n  return <option>{x ? t('a.one') : t('a.two')}</option>;\n}\n",
    );
    assert.equal(r.changed, false);
    assert.equal(r.tally.skipped.string_only_parent, 1);
  });

  test('an option with more than the message is reported, not guessed', () => {
    const r = mark(
      `export function A({ n }) {\n  const t = getServerT(c);\n  return <option>{t('a.opt')} {n}</option>;\n}\n`,
    );
    assert.equal(r.changed, false);
    assert.equal(r.tally.skipped.string_only_parent, 1);
  });
});

describe('the whole pass', () => {
  test('a second run changes nothing', () => {
    const first = mark(
      `export function A() {\n  const t = getServerT(c);\n  return <><p>{t('a.one')}</p><nav aria-label={t('a.nav')} /><select><option>{t('a.o')}</option></select></>;\n}\n`,
    );
    assert.equal(first.changed, true);
    const second = markSource(first.code, 'fixture.tsx');
    assert.equal(second.changed, false);
    assert.equal(second.code, first.code);
  });

  test('red proof: the check the guard relies on sees an unmarked file and passes a marked one', () => {
    const body = `export function A() {\n  const t = getServerT(c);\n  return <p>{t('a.one')}</p>;\n}\n`;
    const unmarked = mark(body);
    assert.equal(unmarked.changed, true, 'an unmarked child must be reported as work to do');
    assert.equal(markSource(unmarked.code, 'f.tsx').changed, false);
    // The old code is what the pass starts from: it must not already contain the marked call.
    assert.ok(!`${HEAD}${body}`.includes('t.node('));
  });

  test('excluded paths are never read or written; dry run writes nothing', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mark-parts-'));
    roots.push(root);
    const src = `${HEAD}export function A() {\n  const t = getServerT(c);\n  return <p>{t('a.one')}</p>;\n}\n`;
    for (const rel of ['apps/web/src/app/a.tsx', 'apps/web/src/components/b.tsx']) {
      fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
      fs.writeFileSync(path.join(root, rel), src);
    }
    const files = ['apps/web/src/app/a.tsx', 'apps/web/src/components/b.tsx'];
    const exclude = ['apps/web/src/components/'];
    runMarkParts({ root, groups: [{ surface: 's', files }], dryRun: true, exclude, format: false });
    assert.equal(fs.readFileSync(path.join(root, files[0]), 'utf8'), src);
    const [report] = runMarkParts({
      root,
      groups: [{ surface: 's', files }],
      exclude,
      format: false,
    });
    assert.deepEqual(report.excluded, ['apps/web/src/components/b.tsx']);
    assert.match(fs.readFileSync(path.join(root, files[0]), 'utf8'), /t\.node\('a\.one'\)/);
    assert.equal(fs.readFileSync(path.join(root, files[1]), 'utf8'), src);
  });
});
