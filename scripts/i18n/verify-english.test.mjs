import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import { compareRenders, normaliseRandom } from './verify-english.mjs';

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function renderDir(scenarios) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-english-'));
  dirs.push(dir);
  fs.mkdirSync(path.join(dir, 'html'));
  const manifest = [];
  for (const s of scenarios) {
    manifest.push({
      slug: s.slug,
      route: s.route,
      locale: s.locale ?? 'en',
      outcome: s.outcome ?? 'ok',
    });
    if (s.html !== undefined) fs.writeFileSync(path.join(dir, 'html', `${s.slug}.html`), s.html);
  }
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
  return { html: path.join(dir, 'html'), manifest: path.join(dir, 'manifest.json') };
}

const base = [
  { slug: 'home', route: 'app/(home)', html: '<h1>Your cases</h1>' },
  { slug: 'home-bangla', route: 'app/(home)', locale: 'bn', html: '<h1>Bengali draft</h1>' },
];

test('identical English passes, and Bengali scenarios are not compared', () => {
  const changedBangla = base.map((s) => (s.locale === 'bn' ? { ...s, html: '<h1>other</h1>' } : s));
  assert.deepEqual(compareRenders(renderDir(base), renderDir(changedBangla)), []);
});

test('one changed character fails with the route and where it changed', () => {
  const after = base.map((s) => (s.slug === 'home' ? { ...s, html: '<h1>Your Cases</h1>' } : s));
  const [d, ...rest] = compareRenders(renderDir(base), renderDir(after));
  assert.equal(rest.length, 0);
  assert.equal(d.route, 'app/(home)');
  assert.equal(d.problem, 'html differs');
  assert.equal(d.at, 9);
});

test('a page that now errors, vanishes or appears fails', () => {
  const errored = base.map((s) =>
    s.slug === 'home'
      ? { ...s, outcome: 'ERROR getServerT called before primeLocale()', html: undefined }
      : s,
  );
  const problems = compareRenders(renderDir(base), renderDir(errored)).map((d) => d.problem);
  assert.deepEqual(problems, [
    'outcome ok -> ERROR getServerT called before primeLocale()',
    'page appeared or disappeared',
  ]);
  const extra = [...base, { slug: 'new', route: 'x', html: '<p>x</p>' }];
  assert.deepEqual(
    compareRenders(renderDir(base), renderDir(extra)).map((d) => d.problem),
    ['new scenario after'],
  );
  assert.deepEqual(
    compareRenders(renderDir(extra), renderDir(base)).map((d) => d.problem),
    ['scenario missing after'],
  );
});

const withRandom = (id, token, nonce, word) =>
  `<main><a href="/app/applicant/${id}">${word}</a><input type="hidden" value="${token}"/><script nonce="${nonce}"></script></main>`;
const ID_A = '0d5d0a9d-5752-4a81-9f75-bfc5e7d7dccb';
const ID_B = '1f1e21a9-6887-4c55-a970-595272f49992';
const TOKEN_A = `eyJmb3JtSWQiOiI4MmNl.${'a'.repeat(30)}`;
const TOKEN_B = `eyJmb3JtSWQiOiIyOTRh.${'b'.repeat(30)}`;

test('a page that differs only in an id, a signed value or a nonce compares equal', () => {
  const a = [{ slug: 'p', route: 'r', html: withRandom(ID_A, TOKEN_A, 'QUJDREVGR0g=', 'Open') }];
  const b = [{ slug: 'p', route: 'r', html: withRandom(ID_B, TOKEN_B, 'WFlaMTIzNDU=', 'Open') }];
  assert.deepEqual(compareRenders(renderDir(a), renderDir(b)), []);
});

test('a real one-character English change is caught even with other values changing too', () => {
  const a = [{ slug: 'p', route: 'r', html: withRandom(ID_A, TOKEN_A, 'QUJDREVGR0g=', 'Open') }];
  const b = [{ slug: 'p', route: 'r', html: withRandom(ID_B, TOKEN_B, 'WFlaMTIzNDU=', 'open') }];
  const [d, ...rest] = compareRenders(renderDir(a), renderDir(b));
  assert.equal(rest.length, 0);
  assert.equal(d.problem, 'html differs');
  assert.match(d.after, /open/);
});

test('normalisation only touches values of those shapes', () => {
  const text = '<p>Case C-7K2Q9M, 3 documents, Sign In</p>';
  assert.equal(normaliseRandom(text), text);
  assert.equal(normaliseRandom(`id ${ID_A}`), 'id <uuid>');
});
