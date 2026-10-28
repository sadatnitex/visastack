import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.4.2 (Page Titled, level A): every page names itself, so a person with a
 * screen reader, a browser tab or a history list can tell pages apart. The root
 * layout gives the product's name and a template ("Documents | VisaStack"); each page
 * supplies its own part. A page without one would silently show the generic title, as
 * every page did before this guard existed.
 */

const APP_DIR = fileURLToPath(new URL('../app', import.meta.url));

/** The home page keeps the layout's default title: the product's own name and tagline. */
const USES_DEFAULT_TITLE = new Set(['page.tsx']);

function pageFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...pageFiles(full));
    else if (entry === 'page.tsx') out.push(full);
  }
  return out;
}

const pages = pageFiles(APP_DIR).map((file) => ({
  file: relative(APP_DIR, file),
  source: readFileSync(file, 'utf8'),
}));

const staticTitle = /export const metadata:\s*Metadata\s*=\s*\{\s*title:\s*'((?:[^'\\]|\\.)+)'/;

describe('page titles', () => {
  it('finds the pages it is meant to check', () => {
    expect(pages.length).toBeGreaterThan(40);
  });

  it('gives every page its own title (a static one, or one built from the page)', () => {
    const missing = pages
      .filter(({ file }) => !USES_DEFAULT_TITLE.has(file))
      .filter(
        ({ source }) =>
          !staticTitle.test(source) && !/export async function generateMetadata\(/.test(source),
      )
      .map(({ file }) => file);
    expect(missing, `pages with no title of their own:\n${missing.join('\n')}`).toEqual([]);
  });

  it('never repeats a static title for two different pages', () => {
    const seen = new Map<string, string>();
    const repeats: string[] = [];
    for (const { file, source } of pages) {
      const title = staticTitle.exec(source)?.[1];
      if (title === undefined) continue;
      const before = seen.get(title);
      if (before) repeats.push(`"${title}": ${before} and ${file}`);
      else seen.set(title, file);
    }
    expect(repeats, repeats.join('\n')).toEqual([]);
  });

  it('keeps titles short and free of the product name (the template adds it)', () => {
    for (const { file, source } of pages) {
      const title = staticTitle.exec(source)?.[1];
      if (title === undefined) continue;
      expect(title.length, `${file}: "${title}"`).toBeLessThanOrEqual(40);
      expect(title, file).not.toMatch(/visastack/i);
    }
  });

  it('names each page for what it is, in the words the navigation uses', () => {
    const titleOf = (file: string) =>
      staticTitle.exec(pages.find((p) => p.file === file)?.source ?? '')?.[1];
    expect(titleOf('app/applicants/page.tsx')).toBe('Applicants');
    // D3: the page is "Notifications"; the menu label follows in the CCD-7 naming pass.
    expect(titleOf('app/notifications/page.tsx')).toBe('Notifications');
    expect(titleOf('app/shared/(list)/page.tsx')).toBe('Shared with Me');
    expect(titleOf('app/applicant/[id]/documents/page.tsx')).toBe('Documents');
    expect(titleOf('app/applicant/[id]/missions/page.tsx')).toBe('Cases');
  });

  it('puts the product name after the page name through the layout template', () => {
    const layout = readFileSync(join(APP_DIR, 'layout.tsx'), 'utf8');
    expect(layout).toContain("template: '%s | VisaStack'");
    expect(layout).toContain("default: 'VisaStack - one profile, every visa'");
  });
});

describe('landmarks', () => {
  const read = (file: string) => readFileSync(join(APP_DIR, file), 'utf8');

  it('tells public and workspace navigation landmarks apart', () => {
    expect(read('layout.tsx')).toContain('<SiteNavigation>');
    expect(read('../components/site-navigation.tsx')).toContain('aria-label="Site"');
    expect(read('layout.tsx')).toContain('aria-label="Footer"');
    expect(read('app/app-nav.tsx')).toContain('aria-label="Workspace"');
  });

  it('says in which language the language switch is written', () => {
    expect(read('layout.tsx')).toMatch(/lang=\{locale === 'en' \? 'bn' : 'en'\}/);
  });
});
