// Opens every web page named in the country sheets and saves its plain text, so a person (or Claude, which
// cannot reach these sites from its own machine) can read what each page really says.
// Meant to run on a GitHub-hosted runner, which has internet access. It reads and writes files only.
// Usage: node scripts/country-packs/fetch-pages.mjs <batchFolder> <outFolder>
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pageText, parseCsv } from './validate-intake.mjs';

const MAX_CHARS = 40000;
const URL_COLUMNS = {
  '0-countries.csv': ['source_url', 'official_apply_url'],
  '1-routes.csv': ['source_url', 'official_application_channel_url'],
};

/** Every distinct https page named in the sheets, in sheet order. */
export function collectUrls(sheets) {
  const urls = [];
  for (const [file, columns] of Object.entries(URL_COLUMNS)) {
    const text = sheets[file];
    if (!text) continue;
    const [header, ...body] = parseCsv(text);
    const names = header.map((h) => h.split(' (')[0].trim());
    for (const row of body) {
      for (const column of columns) {
        const value = (row[names.indexOf(column)] ?? '').trim();
        if (/^https:\/\//.test(value) && !urls.includes(value)) urls.push(value);
      }
    }
  }
  return urls;
}

/** Fetches each page with a small pool; never throws. Returns one result per URL, in order. */
export async function fetchAll(urls, fetchPage, pool = 8) {
  const results = new Array(urls.length);
  let next = 0;
  async function worker() {
    while (next < urls.length) {
      const i = next;
      next += 1;
      const url = urls[i];
      if (/\.pdf($|\?)/i.test(url)) {
        results[i] = { url, status: 'SKIPPED_PDF', text: '' };
        continue;
      }
      try {
        const res = await fetchPage(url);
        results[i] = res.ok
          ? { url, status: 'OK', text: pageText(res.body).slice(0, MAX_CHARS) }
          : { url, status: `HTTP_${res.status}`, text: '' };
      } catch (e) {
        results[i] = { url, status: `ERROR ${String(e.message ?? e).slice(0, 80)}`, text: '' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(pool, urls.length) }, worker));
  return results;
}

async function main() {
  const [batch, out] = process.argv.slice(2);
  if (!batch || !out) throw new Error('usage: fetch-pages.mjs <batchFolder> <outFolder>');
  const sheets = Object.fromEntries(
    Object.keys(URL_COLUMNS).map((f) => [f, readFileSync(join(batch, f), 'utf8')]),
  );
  const urls = collectUrls(sheets);
  const fetchPage = async (url) => {
    const res = await fetch(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; VisaStackIntakeCheck/1.0)',
        accept: 'text/html,*/*',
      },
      signal: AbortSignal.timeout(25000),
      redirect: 'follow',
    });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.text() : '' };
  };
  const results = await fetchAll(urls, fetchPage);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'pages.json'), `${JSON.stringify(results)}\n`);
  const counts = {};
  for (const r of results) counts[r.status] = (counts[r.status] ?? 0) + 1;
  process.stdout.write(`${JSON.stringify({ pages: results.length, counts }, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
