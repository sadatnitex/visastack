import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '..', '..', '..', '..');
const FLAG = 'LOCALE_PREVIEW';
// Files that may set the flag on purpose. Empty: a later package that turns it on in the
// browser-check workflow adds that one file here, in review.
const ALLOWED: string[] = [];

function files(): string[] {
  const out = ['apps/web/vercel.json', 'apps/web/Dockerfile', 'render.yaml'];
  for (const dir of ['.github/workflows', '.']) {
    for (const f of readdirSync(join(root, dir))) {
      if (dir === '.github/workflows' && /\.ya?ml$/.test(f)) out.push(`${dir}/${f}`);
      if (dir === '.' && f.startsWith('.env')) out.push(f);
    }
  }
  for (const f of readdirSync(join(root, 'apps/web')))
    if (f.startsWith('.env')) out.push(`apps/web/${f}`);
  return out;
}

describe('the locale preview flag is never committed', () => {
  it('appears in no deploy config, workflow or env example', () => {
    const hits: string[] = [];
    for (const f of files()) {
      let text: string;
      try {
        text = readFileSync(join(root, f), 'utf8');
      } catch {
        continue;
      }
      if (text.includes(FLAG) && !ALLOWED.includes(f)) hits.push(f);
    }
    expect(hits).toEqual([]);
  });
  it('actually looks at the workflow files', () => {
    expect(files().filter((f) => f.startsWith('.github/workflows/')).length).toBeGreaterThan(3);
  });
});
