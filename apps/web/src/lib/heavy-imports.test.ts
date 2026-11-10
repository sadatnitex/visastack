import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The deployed server stores, for every page, the files of every library its code can reach. The
 * document and image libraries (picture re-encoding, document reading, previews: about 50 MB of
 * native code) are only needed by code that really handles documents or photos, so the shared
 * registries must not import them. If this test fails, move the new import into
 * `providers-media.ts` or `jobs-reading.ts` (or add the new file here on purpose).
 */
const srcRoot = join(import.meta.dirname, '..');

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) sourceFiles(path, out);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(path);
  }
  return out;
}

const files = sourceFiles(srcRoot).map((path) => ({
  path: relative(srcRoot, path),
  text: readFileSync(path, 'utf8'),
}));

// Files that may import the media factories: each really reads or re-encodes documents or photos.
const MEDIA_USERS = [
  'app/api/blob/[key]/route.ts',
  'app/api/documents/hold/route.ts',
  'app/app/agency/[orgId]/actions.ts',
  'app/app/agency/[orgId]/plan/invoices/actions.ts',
  'app/app/applicant/[id]/actions.ts',
  'app/collect/upload/route.ts',
  'lib/ai-reading-ports.ts',
  'lib/jobs-reading.ts',
];
const READING_JOB_USERS = [
  'app/api/jobs/process-ai-reading/run.ts',
  'app/api/jobs/process-intake/route.ts',
];
const HEAVY_ADAPTERS = [
  'BuiltinPreviewRenderer',
  'BuiltinContentLimitsChecker',
  'DeterministicTextExtractor',
  'SharpImageSanitizer',
  'SharpPhotoReencoder',
  'HeicJpegConverter',
];

const importersOf = (module: string) =>
  files
    .filter(({ text }) =>
      new RegExp(`(?:from |import\\()\\s*'[./]+(?:[a-z-]+/)*${module}'`).test(text),
    )
    .map(({ path }) => path)
    .sort();

describe('heavy document and image libraries stay out of the shared registries', () => {
  it.each(['lib/providers.ts', 'lib/jobs.ts'])('%s does not import them', (path) => {
    const text = files.find((file) => file.path === path)?.text ?? '';
    expect(text).not.toBe('');
    for (const name of HEAVY_ADAPTERS) expect(text, `${path} mentions ${name}`).not.toContain(name);
    expect(text).not.toMatch(/from '\.\/(providers-media|jobs-reading|ai-reading-ports)'/);
  });

  it('only the listed files import the media factories', () => {
    expect(importersOf('providers-media')).toEqual([...MEDIA_USERS].sort());
  });

  it('only the two job entry points import the reading jobs', () => {
    expect(importersOf('jobs-reading')).toEqual([...READING_JOB_USERS].sort());
  });
});
