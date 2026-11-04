import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Lane D: a link to a file is minted only by the helpers in documents.ts. The general helper stays
 * private to that module; the evidence copy wrapper (which fixes the original, the download, the
 * purpose naming the send and the identity confirmation) is used only by evidence-submissions.ts.
 */

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, '../../..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name) && !/\.test(-support)?\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function usersOf(identifier: string): string[] {
  return [...sources(join(repo, 'packages')), ...sources(join(repo, 'apps/web/src'))]
    .filter((file) => readFileSync(file, 'utf8').includes(identifier))
    .map((file) => relative(repo, file).replace(/\\/g, '/'))
    .sort();
}

describe('Lane D: who can mint a file link', () => {
  it('keeps the general link helper private to documents.ts', () => {
    expect(usersOf('issueVersionReadRef')).toEqual(['packages/services/src/documents.ts']);
  });

  it('lets only the evidence copy service mint an evidence copy link', () => {
    expect(usersOf('issueEvidenceSubmissionReadRef')).toEqual([
      'packages/services/src/documents.ts',
      'packages/services/src/evidence-submissions.ts',
    ]);
  });
});
