import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { parseCatalog } from './catalog.mjs';
import { runCodemod } from './codemod.mjs';
import { FILES, loadFormatter, loadModule, makeRoot, readTree, render } from './fixtures.mjs';
import { renderedJsxText } from './jsx-text.mjs';
import { KeyAllocator, fileSlug, textSlug } from './keys.mjs';
import { HOLDBACK, Register } from './register.mjs';

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

describe('review queues not signed off', () => {
  const header = 'semantic_group,review_queue,english,bn_BD_draft,automated_checks\n';
  const lookupIn = (queue) =>
    new Register({
      registerCsv: `${header}SG-X,${queue},Terms of use,\u09b6\u09b0\u09cd\u09a4,PASS\n`,
    }).lookup({ file: 'a.tsx', line: 1, censusText: 'Terms of use', english: 'Terms of use' });

  test('a PASS row in the privacy, commercial or official-requirement queue is refused', () => {
    for (const queue of ['PRIVACY_CONSENT_LEGAL', 'COMMERCIAL', 'OFFICIAL_VISA_REQUIREMENT']) {
      const r = lookupIn(queue);
      assert.equal(r.bn, null, queue);
      assert.equal(r.reason, `review_queue_not_signed_off:${queue}`);
    }
  });

  test('a row with no queue is refused, and an ordinary-screen row is used', () => {
    assert.equal(lookupIn('').reason, 'review_queue_not_signed_off:none');
    assert.equal(lookupIn('ORDINARY_UI').reason, null);
    assert.ok(lookupIn('ORDINARY_UI').bn);
  });
});

describe('holdback list', () => {
  const header = 'semantic_group,review_queue,english,bn_BD_draft,automated_checks\n';
  const lookup = (group) =>
    new Register({
      registerCsv: `${header}${group},ORDINARY_UI,Terms,\u09b6\u09b0\u09cd\u09a4,PASS\n`,
    }).lookup({ file: 'a.tsx', line: 1, censusText: 'Terms', english: 'Terms' });

  // The exact list, so deleting a held group (which would let its Bengali ship) turns this red.
  // Adding a held group means adding it here too, in the same change. This is the union of waves A and B.
  const EXPECTED_HELD = [
    'SG-0006fab9',
    'SG-00706ded',
    'SG-0092181b',
    'SG-03518c54',
    'SG-04033af1',
    'SG-079d1f0e',
    'SG-07e1fab2',
    'SG-094bebc7',
    'SG-0a12f492',
    'SG-0c3f69ec',
    'SG-0f9d5b37',
    'SG-11f4fd8f',
    'SG-192889ed',
    'SG-1a432089',
    'SG-1f2c844a',
    'SG-1fec77cc',
    'SG-21824069',
    'SG-22bda9c8',
    'SG-2604b090',
    'SG-260ff35f',
    'SG-289e563b',
    'SG-2b1514c9',
    'SG-2b43768d',
    'SG-319b7d1b',
    'SG-361e0c20',
    'SG-363e13bd',
    'SG-37468a51',
    'SG-4249425b',
    'SG-45ad6a0b',
    'SG-461caf20',
    'SG-48a3b6e0',
    'SG-4bfc56d4',
    'SG-4fbf3546',
    'SG-50c83703',
    'SG-57024979',
    'SG-576d295d',
    'SG-57b3157f',
    'SG-57e8fee4',
    'SG-58cc6dc1',
    'SG-58fc0338',
    'SG-5dfd4948',
    'SG-5e68244c',
    'SG-5efa8d43',
    'SG-63dab094',
    'SG-65a98d6a',
    'SG-678c621d',
    'SG-697612cb',
    'SG-751ac880',
    'SG-75b245d1',
    'SG-7a475bd6',
    'SG-7cebc450',
    'SG-7d8d7a57',
    'SG-7e0dba4b',
    'SG-84514c27',
    'SG-84755ca2',
    'SG-85a723da',
    'SG-86f84a55',
    'SG-8939253f',
    'SG-8987f99a',
    'SG-899d13d1',
    'SG-8b062101',
    'SG-8dca9740',
    'SG-8e79eb73',
    'SG-8ee1a9d7',
    'SG-9574696f',
    'SG-98b5d44d',
    'SG-98c55098',
    'SG-991b05ef',
    'SG-9e771a8e',
    'SG-9f18aa86',
    'SG-a178f7cf',
    'SG-a5b2278c',
    'SG-a5fa0621',
    'SG-ae0400c3',
    'SG-b0b7a8b8',
    'SG-b0cc740f',
    'SG-b21f69f6',
    'SG-b4a4f931',
    'SG-b5644201',
    'SG-b6f48122',
    'SG-bdbe4cd8',
    'SG-c0b36ea9',
    'SG-c26f3e5b',
    'SG-c60f522e',
    'SG-c60ff807',
    'SG-c68a7790',
    'SG-c87e54e8',
    'SG-cb6538b8',
    'SG-cda9a1ac',
    'SG-d028e6a4',
    'SG-d3914f71',
    'SG-d39a9da3',
    'SG-d62d6a52',
    'SG-d6e09908',
    'SG-d7bcf439',
    'SG-d9561170',
    'SG-d9bcf36d',
    'SG-dc081055',
    'SG-dcadd581',
    'SG-e004a268',
    'SG-e00eb31b',
    'SG-e3b1eece',
    'SG-e4a97e33',
    'SG-e53a446b',
    'SG-e5a8b9e8',
    'SG-e956303b',
    'SG-ed74236c',
    'SG-f0429b7a',
    'SG-f0bd6092',
    'SG-f5a73aec',
    'SG-f8a50812',
    'SG-f92f9f0f',
    'SG-fbccaafa',
    'SG-fe6d2f71',
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
    assert.equal(format('{n, plural, one {# item} other {# items}}', { n: 1234 }), '1,234 items');
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
