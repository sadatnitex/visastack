import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectUrls, fetchAll, pageLines } from './fetch-pages.mjs';

test('collects each secure page once, from the country and route sheets', () => {
  const urls = collectUrls({
    '0-countries.csv':
      'country,source_url (exact page),official_apply_url\nA,https://a.example/x,https://a.example/apply\nB,https://a.example/x,\nC,http://c.example,NOT_FOUND\n',
    '1-routes.csv':
      'pack_key,source_url,official_application_channel_url\na.visit,https://a.example/apply,https://r.example/portal\n',
  });
  assert.deepEqual(urls, [
    'https://a.example/x',
    'https://a.example/apply',
    'https://r.example/portal',
  ]);
});

test('keeps going when a page fails, and records why', async () => {
  const pages = {
    'https://ok.example/': {
      ok: true,
      status: 200,
      body: '<p>Fee is 25 USD</p><script>x()</script>',
    },
    'https://gone.example/': { ok: false, status: 404, body: '' },
  };
  const results = await fetchAll(
    [
      'https://ok.example/',
      'https://gone.example/',
      'https://down.example/',
      'https://x.example/f.pdf',
    ],
    async (url) => {
      if (url === 'https://down.example/') throw new Error('connect refused');
      return pages[url];
    },
    2,
  );
  assert.deepEqual(
    results.map((r) => r.status),
    ['OK', 'HTTP_404', 'ERROR connect refused', 'SKIPPED_PDF'],
  );
  assert.match(results[0].text, /fee is 25 usd/);
  assert.doesNotMatch(results[0].text, /x\(\)/);
});

test('prints one line per wanted page, with a cap, and says when a page is not in the sheets', () => {
  const results = [{ url: 'https://a.example/', status: 'OK', text: 'x'.repeat(50) }];
  const lines = pageLines(results, ['https://a.example/', 'https://z.example/'], 10);
  assert.equal(lines[0], `PAGE https://a.example/ [OK] ${'x'.repeat(10)}`);
  assert.equal(lines[1], 'PAGE https://z.example/ [NOT_IN_SHEETS]');
});
