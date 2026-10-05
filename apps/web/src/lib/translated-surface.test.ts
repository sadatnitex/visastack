import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { WEB_SRC, visibleText } from './visible-text.test-support';

/**
 * Commercial V1 Part 9 section 4: a screen that has been given Bangla must not still
 * carry hard-coded English. This reads each translated page, component and action with
 * the TypeScript parser and lists any text a person could see or hear that is written
 * in the code instead of coming from the catalog. The translation tests already prove
 * the catalogs are complete; this proves the screens use them.
 *
 * When a flow is translated, add its files here. A file on this list can never regress
 * to a literal sentence without this test failing.
 */
const TRANSLATED = [
  // The site frame and the screens every visitor can meet.
  'app/layout.tsx',
  'app/not-found.tsx',
  'app/error.tsx',
  'app/global-error.tsx',
  'components/pilot-banner.tsx',
  'components/translation-notice.tsx',
  // The signed-in frame.
  'app/app/layout.tsx',
  'app/app/applicant/[id]/layout.tsx',
  // Account and consent.
  'app/app/page.tsx',
  'app/app/applicants/page.tsx',
  'app/app/account/page.tsx',
  'app/app/add-applicant-form.tsx',
  'app/app/consent-button.tsx',
  'app/app/actions.ts',
  // Alerts.
  'app/app/notifications/page.tsx',
  // Privacy actions.
  'app/app/privacy/page.tsx',
  'app/app/privacy/deletion-panel.tsx',
  'app/app/privacy/large-export-panel.tsx',
  'app/app/privacy/actions.ts',
] as const;

/** Text that is a name, not a sentence to translate: the brand and a language written in its own name. */
const NAMES = new Set(['VisaStack', 'English']);

/**
 * English that is there on purpose, with the reason. The site description is marketing copy that
 * waits for the owner's content review, and is not one of the nine critical flows.
 */
const ENGLISH_ON_PURPOSE = new Set([
  'A universal, pack-composable visa and immigration platform. Turn documents into structured, permission-aware profiles through a governed, AI-assisted (or fully manual) workflow.',
]);

/** Strings that are code, not words: directives, enum values, field names, translation keys, colours, media queries. */
const isPlumbing = (text: string) =>
  text === 'use client' ||
  text === 'use server' ||
  /^[A-Z][A-Z0-9_]+$/.test(text) ||
  /^[a-z]+(?:[A-Z][a-z0-9]*)+$/.test(text) ||
  /^[a-z][A-Za-z0-9_]*(?:\.(?:[A-Za-z0-9_]+|\{\}))+$/.test(text) ||
  /^#[0-9a-fA-F]{3,8}$/.test(text) ||
  /^\([a-z-]+:\s*[a-z0-9-]+\)$/.test(text);

const hardCoded = (file: string) =>
  visibleText(file, readFileSync(join(WEB_SRC, file), 'utf8'))
    .filter(
      (v) =>
        /[A-Za-z]/.test(v.text) &&
        !NAMES.has(v.text) &&
        !ENGLISH_ON_PURPOSE.has(v.text) &&
        !isPlumbing(v.text),
    )
    .map((v) => `${file}:${v.line}: ${JSON.stringify(v.text)}`);

describe('translated screens carry no hard-coded English', () => {
  for (const file of TRANSLATED) {
    it(file, () => {
      const hits = hardCoded(file);
      expect(hits, hits.join('\n')).toEqual([]);
    });
  }

  it('would notice a screen that still has English written in it (so the list above means something)', () => {
    // An untranslated page, as a control: if the scanner found nothing here it could not be trusted.
    expect(hardCoded('app/app/applicant/[id]/documents/page.tsx').length).toBeGreaterThan(10);
  });
});
