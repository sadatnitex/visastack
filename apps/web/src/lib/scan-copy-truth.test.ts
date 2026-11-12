import { readFileSync } from 'node:fs';
import { EN } from '@visastack/i18n';
import { describe, expect, it } from 'vitest';
import { authCatalog } from '../i18n/auth';
import { homeCatalog } from '../i18n/home';

/**
 * Guard for the words about file checks. Until a trusted antivirus scan has recorded a pass for a
 * file, nothing on screen may say the file was scanned, safe, or free of problems. The
 * wording that depends on the platform or on one file is rendered by scan-state.ts and tested
 * there and in the page tests; this guard stops a blanket sentence from being written back into
 * the surfaces that once carried one, and keeps the public pages honest about the gap.
 */

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const SURFACES = {
  addDocuments: '../app/app/applicant/[id]/documents/add/page.tsx',
  uploader: '../app/app/applicant/[id]/document-uploader.tsx',
  documentsList: '../app/app/applicant/[id]/documents/page.tsx',
  importPanel: '../app/app/applicant/[id]/import/import-panel.tsx',
  readingState: './reading-state.ts',
  successLines: './success-lines.ts',
  contributorAccept: '../app/app/contributor-requests/accept/actions.ts',
  pilotBanner: '../components/pilot-banner.tsx',
  signUp: '../app/auth/sign-up/page.tsx',
  terms: '../app/terms/page.tsx',
  privacy: '../app/privacy/page.tsx',
  home: '../app/page.tsx',
} as const;

/** Blanket claims that a file was scanned or is fine, whatever the platform really did. */
const BLANKET_CLAIMS: readonly RegExp[] = [
  /Every file is scanned/i,
  /scanned before anyone can open it/i,
  /scanned for viruses when it arrives/i,
  /No Problems Found/,
  /queued for a safety scan/i,
  /once its safety scan finishes/i,
  /check each one for safety/i,
  /Checked for Safety/,
  /saved and checked for safety/i,
];

describe('words about file checks', () => {
  for (const [name, path] of Object.entries(SURFACES)) {
    it(`${name} makes no blanket claim that files are scanned or fine`, () => {
      const source = read(path);
      for (const claim of BLANKET_CLAIMS) expect(source, String(claim)).not.toMatch(claim);
    });
  }

  it('the catalogue does not call a structurally checked file free of problems', () => {
    expect(EN['document.status.clean']).toBe('Format Checked');
    expect(JSON.stringify(EN)).not.toContain('No Problems Found');
    expect(EN['document.scanning']).not.toMatch(/scanned/i);
  });

  it('Add Documents and the uploader take their check wording from scan-state, not from a literal', () => {
    expect(read(SURFACES.addDocuments)).toContain("from '../../../../../../lib/scan-state'");
    expect(read(SURFACES.uploader)).toContain('uploadCheckNotice(virusScanning)');
  });

  it('the documents list words the badge from the exact file, not from the stored CLEAN value', () => {
    const source = read(SURFACES.documentsList);
    expect(source).toContain('presentScanState');
    expect(source).toContain('loadVersionScanEvidence');
    expect(source).not.toContain('SAFETY_BADGE_KEYS');
  });

  it('the public pages keep saying plainly that virus scanning of uploads is not switched on yet', () => {
    const BETA_NOTICE_KEY = 'auth.authSignUpPage.visastackIsAFreePublicBeta';
    for (const name of ['pilotBanner', 'signUp', 'terms', 'privacy'] as const) {
      let text = read(SURFACES[name]);
      if (name === 'signUp') {
        // The sign-up wording lives in the auth message catalogue. The page must still use the
        // key, and the key's English must hold the exact words, so dropping either turns this red.
        expect(text, 'sign-up page uses the beta notice key').toContain(`t('${BETA_NOTICE_KEY}')`);
        const english = authCatalog.en[BETA_NOTICE_KEY as keyof typeof authCatalog.en];
        expect(english, 'beta notice key has English text').toBeTruthy();
        text = english;
      }
      const flat = text.replace(/\s+/g, ' ');
      expect(flat, name).toContain('virus scanning of uploads');
      expect(flat, name).toContain('not switched on yet');
    }
    // The home wording lives in the home message catalogue: the page must still use the key, and
    // the key's English must hold the exact words.
    const HOME_NOTICE_KEY = 'home.page.itIsFreeToUseAt';
    expect(read(SURFACES.home), 'home page uses the risk notice key').toContain(
      `t('${HOME_NOTICE_KEY}')`,
    );
    expect(homeCatalog.en[HOME_NOTICE_KEY].replace(/\s+/g, ' ')).toContain(
      'protections such as virus scanning of uploads',
    );
  });
});
