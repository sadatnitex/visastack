// Opens every web page named in the country sheets and saves its plain text, so a person (or Claude, which
// cannot reach these sites from its own machine) can read what each page really says.
// Meant to run on a GitHub-hosted runner, which has internet access. It reads and writes files only.
// Usage: node scripts/country-packs/fetch-pages.mjs <batchFolder> <outFolder> [pageToPrint[|word,word] ...]
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pageText, parseCsv } from './validate-intake.mjs';

const MAX_CHARS = 40000;
const URL_COLUMNS = {
  '0-countries.csv': ['source_url', 'official_apply_url'],
  '1-routes.csv': ['source_url', 'official_application_channel_url'],
};

/** The page's words with their original capital letters, for quoting. The lower-case form is for checking only. */
export function pageTextRaw(html) {
  return String(html)
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;|&#34;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&euro;/g, '\u20ac')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

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
          ? {
              url,
              status: 'OK',
              text: pageText(res.body).slice(0, MAX_CHARS),
              raw: pageTextRaw(res.body),
            }
          : { url, status: `HTTP_${res.status}`, text: '' };
      } catch (e) {
        results[i] = { url, status: `ERROR ${String(e.message ?? e).slice(0, 80)}`, text: '' };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(pool, urls.length) }, worker));
  return results;
}

/**
 * One log line per wanted page, for reading in a run log. A wanted item is a page address, optionally followed
 * by "|word,word": then only the stretches around those words are printed (a few hits each) instead of the
 * start of the page, which is how a long page is searched.
 */
export function pageLines(results, wanted, maxChars = 12000, window = 350, hits = 3) {
  const lines = [];
  for (const item of wanted) {
    const [url = '', words = ''] = item.split('|');
    const found = results.find((r) => r.url === url);
    if (!found) {
      lines.push(`PAGE ${url} [NOT_IN_SHEETS]`);
      continue;
    }
    const raw = found.raw ?? found.text;
    const keywords = words
      .split(',')
      .map((w) => w.trim())
      .filter(Boolean);
    if (keywords.length === 0) {
      lines.push(`PAGE ${url} [${found.status}] ${raw.slice(0, maxChars)}`);
      continue;
    }
    const lower = raw.toLowerCase();
    for (const word of keywords) {
      let from = 0;
      let count = 0;
      while (count < hits) {
        const at = lower.indexOf(word.toLowerCase(), from);
        if (at < 0) break;
        const start = Math.max(0, at - window);
        lines.push(`HIT ${url} [${word}] ...${raw.slice(start, at + word.length + window)}...`);
        from = at + word.length + window;
        count += 1;
      }
      if (count === 0) lines.push(`HIT ${url} [${word}] NOT_ON_PAGE`);
    }
  }
  return lines;
}

async function main() {
  const [batch, out, ...wanted] = process.argv.slice(2);
  if (!batch || !out) {
    throw new Error(
      'usage: fetch-pages.mjs <batchFolder> <outFolder> [pageToPrint[|word,word] ...]',
    );
  }
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
  for (const line of pageLines(results, wanted)) process.stdout.write(`${line}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main();
