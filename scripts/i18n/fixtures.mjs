/**
 * Fixtures and a tiny renderer for the codemod tests. The renderer turns a component into the
 * exact text and attributes React would output (JSX compiled by TypeScript, whitespace rules
 * included), so a test can compare the English before and after a rewrite byte for byte.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export const TSCONFIG = JSON.stringify({
  compilerOptions: {
    jsx: 'preserve',
    strict: true,
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'Bundler',
    noEmit: true,
    skipLibCheck: true,
    types: [],
  },
  include: ['src'],
});

export const FILES = {
  'apps/web/src/jsx.d.ts': `declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [name: string]: Record<string, unknown>;
  }
}
`,
  'apps/web/src/components/greeting-card.tsx': `'use client';
import { useState } from 'react';

export function GreetingCard({
  name,
  count,
  open,
}: { name: string; count: number; open: boolean }) {
  const [shown] = useState(true);
  return (
    <section aria-label="Greeting card">
      <h2>Welcome back</h2>
      <p>
        Hello {name}, you have {count} new {count === 1 ? 'message' : 'messages'}.
      </p>
      <button type="button" title={open ? 'Close the panel' : 'Open the panel'}>
        {open ? 'Hide' : 'Show'}
      </button>
      <img src="/x.png" alt={\`Photo of \${name}\`} />
      <p>{shown && 'Shown now'}</p>
      <p>Tom &amp; Jerry&apos;s page</p>
    </section>
  );
}

export const Compact = ({ name }: { name: string }) => <em>Signed in as {name}</em>;
`,
  'apps/web/src/components/notice-panel.tsx': `const LABELS = { open: 'Open case' };

function helperLabel() {
  return <span>Helper text here</span>;
}

export function NoticePanel({ when, ok }: { when: string; ok: boolean }) {
  return (
    <aside>
      <h3>Before you start</h3>
      <p>Last checked {when}.</p>
      <p>
        Read the <a href="/help">help page</a> first.
      </p>
      <p>Status: {ok ? 'ready' : 'waiting'}</p>
      <p>{'Hello ' + when}</p>
      <code>pnpm install</code>
      {helperLabel()}
      <span>{LABELS.open}</span>
    </aside>
  );
}
`,
  'apps/web/src/components/badge.tsx': `export function Badge({ label }: { label: 'New' | 'Old' }) {
  return <b>{label}</b>;
}

export function Tagged() {
  return <Badge label="New" />;
}
`,
  'apps/web/src/components/people-list.tsx': `'use client';
export function PeopleList({ items }: { items: { name: string }[] }) {
  return (
    <ul aria-label="People on this case">
      {items.map((t) => (
        <li key={t.name}>Person {t.name}</li>
      ))}
    </ul>
  );
}
`,
  'apps/web/src/components/shared-note.tsx': `export function SharedNote() {
  return <p>Shared note text</p>;
}
`,
  'apps/web/src/components/uses-shared.tsx': `'use client';
import { SharedNote } from './shared-note';

export function UsesShared() {
  return (
    <div>
      <SharedNote />
    </div>
  );
}
`,
  'apps/web/src/app/(app)/fixture/page.tsx': `import { NoticePanel } from '../../../components/notice-panel';
import { SharedNote } from '../../../components/shared-note';
import { Tagged } from '../../../components/badge';

export default async function FixturePage() {
  const data = await Promise.resolve({ when: 'today' });
  return (
    <main>
      <h1>Your cases</h1>
      <NoticePanel when={data.when} ok />
      <SharedNote />
      <Tagged />
    </main>
  );
}
`,
  'apps/web/src/app/(app)/sync/page.tsx': `export default function SyncPage() {
  return <h1>Not async here</h1>;
}
`,
  'apps/web/src/app/(app)/client-page/page.tsx': `'use client';
export default function ClientPage() {
  return <h1>Client page title</h1>;
}
`,
  'apps/web/src/components/greeting-card.test.tsx': `export const x = <p>Test text only</p>;
`,
  'docs/localization/VISASTACK_TRANSLATION_REGISTER.csv': `semantic_group,review_queue,english,bn_BD_draft,automated_checks
SG-1,ORDINARY_UI,Welcome back,\u09ab\u09bf\u09b0\u09c7 \u0986\u09b8\u09be\u09df \u09b8\u09cd\u09ac\u09be\u0997\u09a4\u09ae,PASS
SG-2,ORDINARY_UI,Hide,\u09b2\u09c1\u0995\u09be\u09a8,GLOSSARY_TERM_MISSING
SG-3,ORDINARY_UI,Photo of {name},\u099b\u09ac\u09bf,PASS
SG-4,ORDINARY_UI,Last checked {when}.,\u09b6\u09c7\u09b7 \u09af\u09be\u099a\u09be\u0987 {when}\u0964,PASS (WARN_LENGTH)
`,
};

/** Stand-ins for the i18n runtime: a real run refuses to start without these files. */
export const RUNTIME_STUBS = {
  'packages/i18n/src/index.ts': 'export const defineCatalog = <C>(catalog: C): C => catalog;\n',
  'apps/web/src/components/i18n-provider.tsx':
    "'use client';\nexport function useT(_catalog: unknown) {\n  return (key: string) => key;\n}\n",
  'apps/web/src/lib/i18n-server.ts':
    'export function getServerT(_catalog: unknown) {\n  return (key: string) => key;\n}\nexport async function primeLocale() {\n  return "en";\n}\n',
};

/** A fresh repository-shaped folder with the fixtures (plus `extra` files; null removes one). */
export function makeRoot(extra = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'i18n-codemod-'));
  const all = { 'apps/web/tsconfig.json': TSCONFIG, ...RUNTIME_STUBS, ...FILES, ...extra };
  for (const [rel, text] of Object.entries(all)) if (text === null) delete all[rel];
  for (const [rel, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
  return root;
}

export const readTree = (root, rels) =>
  Object.fromEntries(
    rels.map((r) => {
      const p = path.join(root, r);
      return [r, fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null];
    }),
  );

// ---------------------------------------------------------------- message formatting
/**
 * The runtime's own message formatter (packages/i18n/src/icu.ts). There is deliberately no
 * stand-in copy: a second implementation could drift from the runtime and quietly decide what
 * the "English is unchanged" tests accept. If the runtime is missing the tests fail loudly.
 */
let formatter = null;
export async function loadFormatter({ icuPath, fresh = false } = {}) {
  if (formatter && !fresh) return formatter;
  const real = icuPath ?? path.join(REPO, 'packages/i18n/src/icu.ts');
  if (!fs.existsSync(real)) throw new Error(`the i18n runtime formatter is missing: ${real}`);
  const mod = await import(real);
  if (typeof mod.formatMessage !== 'function')
    throw new Error('packages/i18n/src/icu.ts no longer exports formatMessage');
  const loaded = {
    name: 'runtime',
    format: (tpl, params) => mod.formatMessage(tpl, params, 'en-GB'),
  };
  if (!icuPath) formatter = loaded;
  return loaded;
}

// ---------------------------------------------------------------- rendering
const VOID = new Set(['img', 'input', 'br', 'hr', 'meta', 'link']);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = (s) => esc(s).replace(/"/g, '&quot;');

/**
 * Load a module of the fixture root (TypeScript compiled with a classic JSX factory) with the
 * i18n runtime and catalogues wired in. Returns its exports.
 */
export function loadModule(root, rel, format, cache = new Map()) {
  if (cache.has(rel)) return cache.get(rel);
  const code = fs.readFileSync(path.join(root, rel), 'utf8');
  const js = ts.transpileModule(code, {
    compilerOptions: {
      jsx: ts.JsxEmit.React,
      jsxFactory: 'h',
      jsxFragmentFactory: 'Fragment',
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: rel,
  }).outputText;
  const exports = {};
  cache.set(rel, exports);
  const translator = (catalog) => (key, params) => format(catalog.en[key] ?? key, params);
  const req = (spec) => {
    if (spec === 'react') return { useState: (v) => [v] };
    if (spec === '@visastack/i18n') return { defineCatalog: (c) => c };
    const base = path.posix.normalize(path.posix.join(path.posix.dirname(rel), spec));
    if (base === 'apps/web/src/components/i18n-provider') return { useT: translator };
    if (base === 'apps/web/src/lib/i18n-server')
      return { getServerT: translator, primeLocale: async () => 'en' };
    const target = ['.tsx', '.ts']
      .map((e) => base + e)
      .find((f) => fs.existsSync(path.join(root, f)));
    if (!target) throw new Error(`cannot load ${spec} from ${rel}`);
    return loadModule(root, target, format, cache);
  };
  new Function('require', 'exports', 'h', 'Fragment', js)(req, exports, h, FRAGMENT);
  return exports;
}

const FRAGMENT = Symbol('Fragment');
function h(type, props, ...children) {
  return { type, props: props ?? {}, children };
}

/** Render an element tree to static HTML (async components awaited). */
export async function render(node) {
  if (node === null || node === undefined || node === false || node === true) return '';
  if (Array.isArray(node)) return (await Promise.all(node.map(render))).join('');
  if (typeof node === 'string' || typeof node === 'number') return esc(node);
  if (node instanceof Promise) return render(await node);
  const { type, props, children } = node;
  if (type === FRAGMENT) return render(children);
  if (typeof type === 'function') return render(await type({ ...props, children }));
  const attrs = Object.entries(props)
    .filter(([k, v]) => k !== 'key' && v !== false && v !== null && v !== undefined)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${escAttr(v)}"`))
    .join('');
  if (VOID.has(type)) return `<${type}${attrs}/>`;
  return `<${type}${attrs}>${await render(children)}</${type}>`;
}
