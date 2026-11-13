import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import ts from 'typescript';
import { parseCatalog } from './catalog.mjs';
import { runCodemod } from './codemod.mjs';
import { FILES, loadFormatter, loadModule, makeRoot, readTree, render } from './fixtures.mjs';
import { renderedJsxText } from './jsx-text.mjs';
import { KeyAllocator, fileSlug, textSlug } from './keys.mjs';
import { HOLDBACK, RELEASED_QUEUES, Register } from './register.mjs';
import { defaultExportFn } from './transform.mjs';

const SRC = Object.keys(FILES).filter((f) => f.endsWith('.tsx'));
const CAT = 'apps/web/src/i18n/fixture.ts';
const SOURCES = 'apps/web/src/i18n/fixture.sources.json';
const TWINS = {
  'apps/web/src/components/twin-a.tsx': `'use client';\nexport function TwinA() {\n  return <div><p>Save changes</p><p>Save changes!</p></div>;\n}\n`,
  'apps/web/src/components/twin-b.tsx': `'use client';\nexport function TwinB() {\n  return <p>Save changes</p>;\n}\n`,
};
const roots = [];

function run(root, files = SRC, opts = {}) {
  const [report] = runCodemod({
    root,
    groups: [{ surface: 'fixture', files }],
    format: false,
    register: Register.load(root),
    reportDir: path.join(root, 'out'),
    ...opts,
  });
  return report;
}
function fresh(extra) {
  const root = makeRoot(extra);
  roots.push(root);
  return root;
}
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const catalog = (root) => parseCatalog(read(root, CAT));
const reasonOf = (report, text) =>
  report.notConverted.find((s) => s.text.includes(text))?.reason ?? null;

after(() => {
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe('a converted surface', () => {
  let root;
  let report;
  let pristine;
  before(() => {
    pristine = fresh();
    root = fresh();
    report = run(root);
  });

  test('client component: one useT at the top of each component, imports added', () => {
    const out = read(root, 'apps/web/src/components/greeting-card.tsx');
    assert.equal(out.match(/const t = useT\(fixtureCatalog\);/g)?.length, 2);
    assert.match(
      out,
      /export function GreetingCard\([^)]*\) \{\n\s+const t = useT\(fixtureCatalog\);\n\s+const \[shown\]/s,
    );
    assert.match(out, /import \{ useT \} from '\.\/i18n-provider';/);
    assert.match(out, /import \{ fixtureCatalog \} from '\.\.\/i18n\/fixture';/);
    // Expression-bodied arrow component gets a block body that returns the original JSX.
    assert.match(
      out,
      /export const Compact = \(\{ name \}: \{ name: string \}\) => \{\n\s+const t = useT\(fixtureCatalog\);\n\s+return <em>\{t\('fixture\.greetingCard\.signedInAsName', \{ name \}\)\}<\/em>;\n\}/,
    );
    assert.ok(!/getServerT|primeLocale/.test(out));
  });

  test('server component: getServerT, never a hook', () => {
    const out = read(root, 'apps/web/src/components/notice-panel.tsx');
    assert.match(
      out,
      /export function NoticePanel\([^)]*\) \{\n\s+const t = getServerT\(fixtureCatalog\);/s,
    );
    assert.match(out, /import \{ getServerT \} from '\.\.\/lib\/i18n-server';/);
    assert.ok(!/useT/.test(out));
    assert.match(out, /<h3>\{t\('fixture\.noticePanel\.beforeYouStart'\)\}<\/h3>/);
  });

  test('async page: primeLocale is awaited before getServerT', () => {
    const out = read(root, 'apps/web/src/app/(app)/fixture/page.tsx');
    assert.match(
      out,
      /export default async function FixturePage\(\) \{\n\s+await primeLocale\(\);\n\s+const t = getServerT\(fixtureCatalog\);\n\s+const data = await/,
    );
    assert.match(
      out,
      /import \{ getServerT, primeLocale \} from '\.\.\/\.\.\/\.\.\/lib\/i18n-server';/,
    );
  });

  test('a page that is not async, or is a client page, is reported and left as it was', () => {
    for (const rel of [
      'apps/web/src/app/(app)/sync/page.tsx',
      'apps/web/src/app/(app)/client-page/page.tsx',
    ])
      assert.equal(read(root, rel), FILES[rel]);
    assert.deepEqual(
      report.fileSkips.filter((f) => /page\.tsx$/.test(f.file)),
      [
        { file: 'apps/web/src/app/(app)/client-page/page.tsx', reason: 'client_route_entry' },
        { file: 'apps/web/src/app/(app)/sync/page.tsx', reason: 'route_entry_not_async' },
      ],
    );
    assert.equal(reasonOf(report, 'Not async here'), 'route_entry_not_async');
  });

  test('template literals and text with values become one message with named values', () => {
    const en = catalog(root).en;
    assert.equal(en['fixture.greetingCard.photoOfName'], 'Photo of {name}');
    assert.equal(en['fixture.noticePanel.lastCheckedWhen'], 'Last checked {when}.');
    const out = read(root, 'apps/web/src/components/greeting-card.tsx');
    assert.match(out, /alt=\{t\('fixture\.greetingCard\.photoOfName', \{ name \}\)\}/);
  });

  test('an English plural ending becomes an exact plural message', () => {
    assert.equal(
      catalog(root).en['fixture.greetingCard.helloNameYouHaveCountNew'],
      '{count, plural, =1 {Hello {name}, you have {count} new message.} other {Hello {name}, you have {count} new messages.}}',
    );
  });

  test('ternary and && branches each get a key; attributes too', () => {
    const out = read(root, 'apps/web/src/components/greeting-card.tsx');
    assert.match(
      out,
      /title=\{open \? t\('fixture\.greetingCard\.closeThePanel'\) : t\('fixture\.greetingCard\.openThePanel'\)\}/,
    );
    assert.match(
      out,
      /\{open \? t\('fixture\.greetingCard\.hide'\) : t\('fixture\.greetingCard\.show'\)\}/,
    );
    assert.match(out, /\{shown && t\('fixture\.greetingCard\.shownNow'\)\}/);
    assert.match(out, /<section aria-label=\{t\('fixture\.greetingCard\.greetingCard'\)\}>/);
    assert.equal(catalog(root).en['fixture.greetingCard.tomJerrySPage'], "Tom & Jerry's page");
  });

  test('ambiguous cases are left untouched and reported with a reason', () => {
    const expected = {
      'Read the': 'sentence_split_by_inline_element',
      'help page': 'sentence_split_by_inline_element',
      'Status:': 'conditional_inside_sentence',
      "'Hello ' + when": 'string_concatenation',
      'pnpm install': 'code_element',
      'Helper text here': 'non_component_function',
      'Open case': 'module_label_map',
      Person: 'name_conflict_t',
      'Shared note text': 'shared_client_server_module',
      'Client page title': 'client_route_entry',
    };
    for (const [text, reason] of Object.entries(expected))
      assert.equal(reasonOf(report, text), reason, text);
    const lit = report.notConverted.find((s) => s.text === 'New');
    assert.equal(lit?.reason, 'prop_typed_as_literal_union');
    const notice = read(root, 'apps/web/src/components/notice-panel.tsx');
    for (const kept of [
      'Read the <a href="/help">help page</a> first.',
      "{'Hello ' + when}",
      '<code>pnpm install</code>',
      '<span>Helper text here</span>',
      "{ open: 'Open case' }",
      "Status: {ok ? 'ready' : 'waiting'}",
    ])
      assert.ok(notice.includes(kept), kept);
    assert.ok(read(root, 'apps/web/src/components/people-list.tsx').includes('Person {t.name}'));
    assert.equal(
      read(root, 'apps/web/src/components/shared-note.tsx'),
      FILES['apps/web/src/components/shared-note.tsx'],
    );
    assert.deepEqual(
      report.fileSkips.find((f) => f.file.endsWith('.test.tsx')),
      { file: 'apps/web/src/components/greeting-card.test.tsx', reason: 'excluded_test_file' },
    );
    assert.equal(
      read(root, 'apps/web/src/components/greeting-card.test.tsx'),
      FILES['apps/web/src/components/greeting-card.test.tsx'],
    );
  });

  test('Bengali only from PASS rows with the same placeholders; sources traced', () => {
    const c = catalog(root);
    // Stored NFC-normalised, as the runtime's checks require (U+09DF decomposes to U+09AF U+09BC).
    assert.equal(
      c.bn['fixture.greetingCard.welcomeBack'],
      '\u09ab\u09bf\u09b0\u09c7 \u0986\u09b8\u09be\u09af\u09bc \u09b8\u09cd\u09ac\u09be\u0997\u09a4\u09ae',
    );
    assert.equal(
      c.bn['fixture.noticePanel.lastCheckedWhen'],
      '\u09b6\u09c7\u09b7 \u09af\u09be\u099a\u09be\u0987 {when}\u0964',
    );
    assert.equal(c.bn['fixture.greetingCard.hide'], undefined);
    assert.equal(c.bn['fixture.greetingCard.photoOfName'], undefined);
    const missing = Object.fromEntries(report.bengaliMissing.map((m) => [m.english, m.reason]));
    assert.equal(missing.Hide, 'checks_not_pass:GLOSSARY_TERM_MISSING');
    assert.equal(missing['Photo of {name}'], 'bn_placeholders_differ');
    assert.equal(missing.Show, 'no_register_match');
    const sources = JSON.parse(read(root, SOURCES));
    assert.equal(sources['fixture.greetingCard.welcomeBack'], 'SG-1');
    assert.equal(sources['fixture.greetingCard.hide'], 'SG-2');
    assert.equal(sources['fixture.greetingCard.show'], null);
  });

  test('the English a person sees is byte-identical before and after', async () => {
    const { format } = await loadFormatter();
    const cases = [
      [
        'apps/web/src/components/greeting-card.tsx',
        'GreetingCard',
        { name: 'Ana', count: 1, open: true },
      ],
      [
        'apps/web/src/components/greeting-card.tsx',
        'GreetingCard',
        { name: 'Ana', count: 0, open: false },
      ],
      [
        'apps/web/src/components/greeting-card.tsx',
        'GreetingCard',
        { name: 'Ana', count: 12, open: false },
      ],
      ['apps/web/src/components/greeting-card.tsx', 'Compact', { name: 'Ana' }],
      ['apps/web/src/components/notice-panel.tsx', 'NoticePanel', { when: 'today', ok: false }],
      ['apps/web/src/components/people-list.tsx', 'PeopleList', { items: [{ name: 'Ana' }] }],
      ['apps/web/src/app/(app)/fixture/page.tsx', 'default', {}],
    ];
    for (const [rel, name, props] of cases) {
      const beforeHtml = await render(loadModule(pristine, rel, format)[name](props));
      const afterHtml = await render(loadModule(root, rel, format)[name](props));
      assert.ok(beforeHtml.length > 20, `${rel} rendered`);
      assert.equal(afterHtml, beforeHtml, `${rel} ${JSON.stringify(props)}`);
    }
  });

  test('a second run changes nothing', () => {
    const rels = [...SRC, CAT, SOURCES];
    const first = readTree(root, rels);
    const firstReport = read(root, 'out/fixture.report.json');
    const again = run(root);
    assert.deepEqual(readTree(root, rels), first);
    assert.equal(again.summary.changedFiles.length, 0);
    assert.equal(again.converted.length, 0);
    assert.notEqual(read(root, 'out/fixture.report.json'), firstReport); // nothing left to convert
  });
});

describe('keys', () => {
  test('are deterministic whatever order the files are given in', () => {
    const files = [...SRC, ...Object.keys(TWINS)];
    const a = fresh(TWINS);
    const b = fresh(TWINS);
    run(a, files);
    run(b, [...files].reverse());
    const rels = [...files, CAT, SOURCES];
    assert.deepEqual(readTree(a, rels), readTree(b, rels));
  });

  test('identical English shares one key; a clash of slugs is settled by a hash', () => {
    const root = fresh(TWINS);
    run(root, Object.keys(TWINS));
    const en = catalog(root).en;
    assert.deepEqual(
      Object.keys(en).sort(),
      [
        'fixture.twinA.saveChanges',
        `fixture.twinA.saveChanges${(/^fixture\.twinA\.saveChanges([0-9a-f]{6})$/.exec(Object.keys(en).find((k) => k !== 'fixture.twinA.saveChanges')) ?? [])[1]}`,
      ].sort(),
    );
    assert.equal(en['fixture.twinA.saveChanges'], 'Save changes');
    assert.match(
      read(root, 'apps/web/src/components/twin-b.tsx'),
      /t\('fixture\.twinA\.saveChanges'\)/,
    );
  });

  test('existing keys are reused and never renamed', () => {
    const alloc = new KeyAllocator('docs', { 'docs.old.anything': 'Upload' });
    assert.equal(alloc.keyFor('apps/web/src/app/x/page.tsx', 'Upload'), 'docs.old.anything');
    assert.equal(alloc.keyFor('apps/web/src/app/x/page.tsx', 'Upload now'), 'docs.xPage.uploadNow');
  });

  test('slugs drop route groups and punctuation', () => {
    assert.equal(fileSlug('apps/web/src/app/(app)/documents/[id]/page.tsx'), 'documentsIdPage');
    assert.equal(fileSlug('apps/web/src/components/pilot-banner.tsx'), 'pilotBanner');
    assert.equal(
      textSlug("You're all set, {name}! Next: upload six more files"),
      'youReAllSetNameNext',
    );
  });
});

describe('dry run', () => {
  test('counts without writing anything', () => {
    const root = fresh();
    const rels = [...SRC, CAT, SOURCES];
    const before = readTree(root, rels);
    const report = run(root, SRC, { dryRun: true });
    assert.deepEqual(readTree(root, rels), before);
    // It counts exactly what a real run converts.
    const real = run(fresh(), SRC);
    assert.equal(report.converted.length, 15);
    assert.deepEqual(report.converted, real.converted);
    assert.deepEqual(report.notConverted, real.notConverted);
  });
});

describe('review queues', () => {
  const header = 'semantic_group,review_queue,english,bn_BD_draft,automated_checks\n';
  const lookupIn = (queue) =>
    new Register({
      registerCsv: `${header}SG-X,${queue},Terms of use,\u09b6\u09b0\u09cd\u09a4,PASS\n`,
    }).lookup({ file: 'a.tsx', line: 1, censusText: 'Terms of use', english: 'Terms of use' });

  // Owner decision 2026-11-12: queues 02 (commercial) and 03 (privacy, consent, legal) are signed off.
  test('a PASS row in the privacy or commercial queue is used (owner sign-off 2026-11-12)', () => {
    for (const queue of ['PRIVACY_CONSENT_LEGAL', 'COMMERCIAL']) {
      const r = lookupIn(queue);
      assert.equal(r.reason, null, queue);
      assert.ok(r.bn, queue);
    }
  });

  test('a PASS row in the official-requirement queue is still refused', () => {
    const r = lookupIn('OFFICIAL_VISA_REQUIREMENT');
    assert.equal(r.bn, null);
    assert.equal(r.reason, 'review_queue_not_signed_off:OFFICIAL_VISA_REQUIREMENT');
  });

  test('a row with no queue is refused, and an ordinary-screen row is used', () => {
    assert.equal(lookupIn('').reason, 'review_queue_not_signed_off:none');
    assert.equal(lookupIn('ORDINARY_UI').reason, null);
    assert.ok(lookupIn('ORDINARY_UI').bn);
  });

  test('the released queues are exactly ordinary, commercial and privacy-consent-legal', () => {
    assert.deepEqual([...RELEASED_QUEUES].sort(), [
      'COMMERCIAL',
      'ORDINARY_UI',
      'PRIVACY_CONSENT_LEGAL',
    ]);
  });
});

describe('holdback list', () => {
  const header = 'semantic_group,review_queue,english,bn_BD_draft,automated_checks\n';
  const lookup = (group) =>
    new Register({
      registerCsv: `${header}${group},ORDINARY_UI,Terms,\u09b6\u09b0\u09cd\u09a4,PASS\n`,
    }).lookup({ file: 'a.tsx', line: 1, censusText: 'Terms', english: 'Terms' });

  // The exact list, so deleting a held group (which would let its Bengali ship) turns this red.
  // Adding a held group means adding it here too, in the same change. This is the union of every merged wave.
  const EXPECTED_HELD = [
    'SG-01aeac1c',
    'SG-01e34e77',
    'SG-02122e22',
    'SG-02a56416',
    'SG-04e98a42',
    'SG-066180d4',
    'SG-0a12f492',
    'SG-0a629d98',
    'SG-0b6663fd',
    'SG-0c3da2e7',
    'SG-0e9f785b',
    'SG-103526c4',
    'SG-11f4fd8f',
    'SG-153f9777',
    'SG-1549c176',
    'SG-16600835',
    'SG-19b168cd',
    'SG-1ce16669',
    'SG-1d11e900',
    'SG-1f2c844a',
    'SG-21e2947f',
    'SG-260ff35f',
    'SG-2625eb6a',
    'SG-2e2357fd',
    'SG-32f5aefc',
    'SG-338d92d1',
    'SG-37c14fc0',
    'SG-3a35db0e',
    'SG-3d6b855e',
    'SG-4bd5843b',
    'SG-4e812a3e',
    'SG-4fbf3546',
    'SG-575944d9',
    'SG-58cc6dc1',
    'SG-59d94eb1',
    'SG-5a6c4e41',
    'SG-5cbaeb71',
    'SG-5d43545f',
    'SG-5e7adbab',
    'SG-61e87632',
    'SG-658e1cac',
    'SG-6840bbdb',
    'SG-68e8afb4',
    'SG-6cdf21a6',
    'SG-742d2250',
    'SG-75b245d1',
    'SG-76e5623e',
    'SG-79505021',
    'SG-7ba0413d',
    'SG-7fed393b',
    'SG-826d2c99',
    'SG-8546093a',
    'SG-86f84a55',
    'SG-8881fc69',
    'SG-8d14d065',
    'SG-8fd6641e',
    'SG-95ad8477',
    'SG-95b07104',
    'SG-9d878677',
    'SG-9e771a8e',
    'SG-a467fb90',
    'SG-a5fa0621',
    'SG-a7694752',
    'SG-a818802f',
    'SG-a8684ed6',
    'SG-aa9771db',
    'SG-ac40a214',
    'SG-acdb0e90',
    'SG-ad36e94f',
    'SG-aeff30b3',
    'SG-afed0db1',
    'SG-b1994b75',
    'SG-b3edb4f6',
    'SG-b41c58b1',
    'SG-b4a4f931',
    'SG-b59bc29b',
    'SG-b6c2f783',
    'SG-b8f9ef37',
    'SG-ba0fbeb7',
    'SG-bd7b343f',
    'SG-c0b36ea9',
    'SG-c1f08b9e',
    'SG-c1fb8969',
    'SG-c55cd000',
    'SG-c60ff807',
    'SG-c67c0fbc',
    'SG-c87bb1a1',
    'SG-c87e54e8',
    'SG-c9a7f414',
    'SG-cb6538b8',
    'SG-ccadbccd',
    'SG-ccbd8ad0',
    'SG-d0d5e75c',
    'SG-d10ae531',
    'SG-d2c91826',
    'SG-d5319908',
    'SG-d6e09908',
    'SG-d9561170',
    'SG-d9696fe7',
    'SG-db11732d',
    'SG-dc1af39a',
    'SG-de969496',
    'SG-dedaa54b',
    'SG-e004a268',
    'SG-e3fdc097',
    'SG-e4498255',
    'SG-e6123c0d',
    'SG-e70b69ad',
    'SG-e8727ba5',
    'SG-eb382184',
    'SG-ecd96750',
    'SG-f22cca12',
    'SG-f3c3a277',
    'SG-f6430216',
    'SG-f974eb5d',
    'SG-fe5feab6',
    'SG-ff7d2a1c',
  ];

  test('names exactly the held groups, each with a reason', () => {
    assert.deepEqual([...HOLDBACK.keys()].sort(), EXPECTED_HELD);
    for (const [group, reason] of HOLDBACK) assert.ok(reason.length > 10, group);
  });

  test('a held row stays English even when its queue is released and its checks pass', () => {
    for (const group of HOLDBACK.keys()) {
      const r = lookup(group);
      assert.equal(r.bn, null, group);
      assert.match(r.reason, /^held_back:/);
    }
    assert.ok(lookup('SG-other').bn);
  });
});

describe('a failed format', () => {
  // A formatter that scribbles over every file it was given and then exits 1, like a broken tool.
  const failing = (root, rels) => {
    for (const rel of rels) fs.writeFileSync(path.join(root, rel), 'GARBAGE');
    throw new Error('formatter exited 1');
  };
  const touched = (root) =>
    [...SRC, CAT, SOURCES, ...Object.keys(TWINS)].filter((r) => fs.existsSync(path.join(root, r)));

  test('a first conversion leaves every file as it was, and creates none', () => {
    const root = fresh(TWINS);
    const rels = [...SRC, ...Object.keys(TWINS), CAT, SOURCES];
    const before = readTree(root, rels);
    assert.throws(
      () => run(root, [...SRC, ...Object.keys(TWINS)], { format: true, formatter: failing }),
      /formatter exited 1/,
    );
    assert.deepEqual(readTree(root, rels), before);
    assert.equal(fs.existsSync(path.join(root, CAT)), false);
    assert.equal(fs.existsSync(path.join(root, SOURCES)), false);
  });

  test('a later conversion puts back the catalogue and sources already on disk', () => {
    const root = fresh(TWINS);
    run(root, SRC);
    const rels = touched(root);
    const before = readTree(root, rels);
    assert.ok(before[CAT]);
    assert.throws(
      () => run(root, [...SRC, ...Object.keys(TWINS)], { format: true, formatter: failing }),
      /formatter exited 1/,
    );
    assert.deepEqual(readTree(root, touched(root)), before);
  });
});

describe('the formatter used to prove English is unchanged', () => {
  test('is the real runtime, never a copy', async () => {
    const { name, format } = await loadFormatter();
    assert.equal(name, 'runtime');
    // The old stand-in turned every # into the number, even inside a nested {braces} message.
    assert.equal(format('{n, plural, one {# item} other {# items}}', { n: 1234 }), '1234 items');
  });

  test('a missing packages/i18n/src/icu.ts makes it throw instead of falling back to a copy', async () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'icu-missing-'));
    try {
      const missing = path.join(empty, 'packages/i18n/src/icu.ts');
      await assert.rejects(loadFormatter({ icuPath: missing, fresh: true }), (e) =>
        e.message.includes(`the i18n runtime formatter is missing: ${missing}`),
      );
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
    }
  });
});

describe('JSX text rules', () => {
  test('line breaks and indentation collapse as the JSX transform does', () => {
    assert.deepEqual(renderedJsxText('\n    Hello\n    world  \n  '), { text: 'Hello world' });
    assert.deepEqual(renderedJsxText(' Save'), { text: ' Save' });
    assert.deepEqual(renderedJsxText('A &amp; B &#8212; C'), { text: 'A & B \u2014 C' });
  });
  test('anything the transforms could disagree on is refused', () => {
    assert.deepEqual(renderedJsxText('a\tb'), { error: 'tab_in_jsx_text' });
    assert.equal(renderedJsxText('a &bogus; b').error, 'unknown_html_entity:&bogus;');
    assert.deepEqual(renderedJsxText('a\n  &nbsp;b'), { error: 'nbsp_at_line_edge' });
  });
});

describe('review cases', () => {
  const EDGE = {
    'apps/web/src/components/outer-t.tsx': `'use client';
export function Outer() {
  const t = (k: string) => k.toUpperCase();
  const Row = () => (
    <div>
      <span>{t('legacy.key')}</span>
      <p>Hello there</p>
    </div>
  );
  return <Row />;
}
`,
    'apps/web/src/components/cells.tsx': `'use client';
const Cell = (x: string) => <td>Cell label {x}</td>;

export function Table({ rows }: { rows: string[] }) {
  return (
    <table>
      <tbody>
        <tr>{rows.map(Cell)}</tr>
        <tr>
          <td>Table caption here</td>
        </tr>
      </tbody>
    </table>
  );
}
`,
    'apps/web/src/components/loop-t.tsx': `'use client';
export function Loop({ items }: { items: string[] }) {
  return (
    <ul>
      {items.map((x) => {
        for (const t of [1]) void t;
        try {
          void x;
        } catch (t) {
          void t;
        }
        return <li key={x}>Item name</li>;
      })}
    </ul>
  );
}
`,
    'apps/web/src/components/aliased.tsx': `'use client';
import { useT } from '@/components/i18n-provider';

export function Aliased() {
  void useT;
  return <p>Aliased text here</p>;
}
`,
    'apps/web/src/components/open-a.tsx': `'use client';
export function OpenA() {
  return <span>Open</span>;
}
`,
    'apps/web/src/components/open-b.tsx': `'use client';
export function OpenB() {
  return <button type="button">Open</button>;
}
`,
    'docs/localization/VISASTACK_UI_SOURCE_CENSUS.csv': `file,line_start,english,semantic_group
apps/web/src/components/open-a.tsx,3,Open,SG-STATUS
apps/web/src/components/open-b.tsx,3,Open,SG-ACTION
`,
    'docs/localization/VISASTACK_TRANSLATION_REGISTER.csv': `semantic_group,review_queue,english,bn_BD_draft,automated_checks
SG-STATUS,ORDINARY_UI,Open,\u0996\u09cb\u09b2\u09be,PASS
SG-ACTION,ORDINARY_UI,Open,\u0996\u09c1\u09b2\u09c1\u09a8,PASS
`,
  };
  const files = Object.keys(EDGE).filter((f) => f.endsWith('.tsx'));
  let root;
  let report;
  before(() => {
    root = fresh(EDGE);
    report = run(root, files);
  });

  test('a t from an enclosing function is never hidden', () => {
    assert.equal(reasonOf(report, 'Hello there'), 'name_conflict_t_outer');
    assert.equal(
      read(root, 'apps/web/src/components/outer-t.tsx'),
      EDGE['apps/web/src/components/outer-t.tsx'],
    );
  });

  test('a component called as a plain function gets no hook', () => {
    assert.equal(reasonOf(report, 'Cell label'), 'component_called_as_function');
    const out = read(root, 'apps/web/src/components/cells.tsx');
    assert.match(out, /const Cell = \(x: string\) => <td>Cell label \{x\}<\/td>;/);
    assert.match(out, /<td>\{t\('fixture\.cells\.tableCaptionHere'\)\}<\/td>/);
  });

  test('a t in a loop or catch clause only hides ours inside that loop or clause', () => {
    assert.match(
      read(root, 'apps/web/src/components/loop-t.tsx'),
      /t\('fixture\.loopT\.itemName'\)/,
    );
  });

  test('an existing alias import is reused, not duplicated', () => {
    const out = read(root, 'apps/web/src/components/aliased.tsx');
    assert.equal(out.match(/useT\b.*from/g)?.length, 1);
    assert.match(out, /t\('fixture\.aliased\.aliasedTextHere'\)/);
  });

  test('English with two meanings keeps one key and one Bengali per meaning', () => {
    const c = catalog(root);
    const keys = Object.keys(c.en).filter((k) => c.en[k] === 'Open');
    assert.equal(keys.length, 2);
    assert.deepEqual(
      keys.map((k) => c.bn[k]).sort(),
      ['\u0996\u09c1\u09b2\u09c1\u09a8', '\u0996\u09cb\u09b2\u09be'].sort(),
    );
    const sources = JSON.parse(read(root, SOURCES));
    assert.deepEqual(keys.map((k) => sources[k]).sort(), ['SG-ACTION', 'SG-STATUS']);
  });

  test('a file named twice (relative and absolute) is processed once', () => {
    const r2 = fresh(EDGE);
    const rel = 'apps/web/src/components/open-a.tsx';
    const rep = run(r2, [rel, path.join(r2, rel)]);
    assert.deepEqual(rep.files, [rel]);
    assert.equal(rep.converted.length, 1);
  });

  test('a real run stops before touching anything when the runtime is missing', () => {
    const r3 = fresh({ 'apps/web/src/lib/i18n-server.ts': null });
    const before = readTree(r3, SRC);
    assert.throws(() => run(r3), /i18n runtime is not on this branch.*i18n-server\.ts/);
    assert.deepEqual(readTree(r3, SRC), before);
    assert.equal(run(r3, SRC, { dryRun: true }).converted.length, 15);
  });
});

describe('the default export of a page with overloads', () => {
  const parse = (text) => ts.createSourceFile('page.tsx', text, ts.ScriptTarget.Latest, true);
  test('overload signatures with no body are skipped; the implementation is found', () => {
    const sf = parse(
      'export default function Page(a: string): string;\nexport default function Page(a: number): number;\nexport default function Page(a: unknown) { return a; }\n',
    );
    const found = defaultExportFn(sf);
    assert.ok(found?.body, 'the function with a body is returned');
    assert.equal(found.parameters[0].type.getText(sf), 'unknown');
  });
  test('a lone signature with no body is not a page function', () => {
    assert.equal(
      defaultExportFn(parse('export default function Page(a: string): string;\n')),
      null,
    );
  });
});
