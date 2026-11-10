import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CATALOGUE_PURPOSES } from '@visastack/core/catalogue';
import { CATALOGUE_DOCUMENTS } from '@visastack/core/catalogue/documents';
import { describe, expect, it } from 'vitest';
import { ICON_NAMES, iconDrawing } from '../components/icons';
import {
  DOCUMENT_ICONS,
  GENERIC_DOCUMENT_ICON,
  KIND_TONES,
  PURPOSE_FAMILIES,
  PURPOSE_FAMILY_ICON,
  SHARED_ON_PURPOSE,
  STATE_TONES,
  STATUS_ICON_BY_WORD,
  documentKey,
  documentMark,
  hasOwnDocumentIcon,
  hasOwnPurposeIcon,
  purposeMark,
  statusIcon,
  statusIconFor,
  statusMark,
  toneName,
} from './item-icons';
import {
  CHIP_WORDS,
  COVERED_STATUS,
  FRESHNESS_UNKNOWN_STATUS,
  GRANT_STATUS,
  INVITATION_STATUS,
  REQUIREMENT_STATUS,
  type StatusWord,
} from './status-words';

/**
 * The picture map (owner decision, 10 Nov 2026). Three things are held here: every document type,
 * every purpose and every status word resolves to a picture; the three kinds of meaning never
 * share a symbol by accident; and the colours are only the six Harbor tones.
 */

const SIX_TONES = ['blue', 'green', 'amber', 'red', 'violet', 'teal'];

/**
 * The catalogue types that have no picture of their own and read as a plain document. This list is
 * pinned on purpose: a new catalogue type lands here (and fails the test) until someone decides
 * whether it deserves a picture, so the fallback is counted and listed, never hidden. They are
 * forms, contracts, orders, reports and appointment slips: papers with no one shape.
 */
const DOCUMENT_FALLBACKS: readonly string[] = [
  'AUDIT_REPORT',
  'SHARE_REGISTER',
  'BUSINESS_CARD',
  'EMPLOYMENT_CONTRACT',
  'FREELANCE_CONTRACT',
  'LABOUR_CONTRACT',
  'FORM_I20',
  'FORM_DS2019',
  'CAS_STATEMENT',
  'THESIS',
  'RESEARCH_PUBLICATION',
  'RESEARCH_PROPOSAL',
  'SERVICE_BOND_AGREEMENT',
  'HOSPITAL_APPOINTMENT',
  'PRESCRIPTION',
  'COURT_ORDER',
  'LEGAL_DOCUMENT',
  'POWER_OF_ATTORNEY',
  'FAMILY_REGISTER',
  'CUSTODY_ORDER',
  'RELATIONSHIP_PROOF',
  'DEPENDENT_PROOF',
  'COMMUNICATION_RECORD',
  'HOME_STUDY_REPORT',
  'ANCESTOR_RECORD',
  'HOST_IMMIGRATION_STATUS_PROOF',
  'ADDRESS_PROOF',
  'UTILITY_BILL',
  'RENTAL_AGREEMENT',
  'VISA_APPLICATION_FORM',
  'DS160_CONFIRMATION',
  'FORM_14A',
  'SCHENGEN_APPLICATION',
  'UK_VISA_APPLICATION',
  'CANADA_IMM_FORM',
  'AUSTRALIA_FORM_80',
  'APPLICATION_RECEIPT',
  'COURIER_TRACKING_SLIP',
  'SIGNATURE_SPECIMEN',
  'BIOMETRIC_RECEIPT',
  'VFS_APPOINTMENT',
  'EMBASSY_APPOINTMENT',
  'CURRICULUM_VITAE',
  'OTHER',
  'ASSET_VALUATION_REPORT',
  'OTHER_LEGAL_DOCUMENT',
  'OTHER_FAMILY_DOCUMENT',
  'OTHER_APPLICATION_DOCUMENT',
  'OTHER_LEGALISATION_DOCUMENT',
];

describe('document types', () => {
  it('has the catalogue it is mapping', () => {
    expect(CATALOGUE_DOCUMENTS.length).toBeGreaterThan(200);
  });

  it('gives every catalogue document type a picture and a kind tone', () => {
    for (const document of CATALOGUE_DOCUMENTS) {
      const mark = documentMark(document.key);
      expect(DOCUMENT_ICONS, document.key).toContain(mark.icon);
      expect(SIX_TONES, document.key).toContain(mark.tone);
      expect(KIND_TONES, document.key).toContain(mark.tone);
    }
  });

  it('counts and lists the types that fall back to the plain document', () => {
    const fallbacks = CATALOGUE_DOCUMENTS.filter((d) => !hasOwnDocumentIcon(d.key))
      .map((d) => d.key)
      .sort();
    expect(fallbacks).toEqual([...DOCUMENT_FALLBACKS].sort());
    expect(fallbacks.length).toBe(49);
  });

  it('names no key the catalogue does not hold', () => {
    const keys = new Set(CATALOGUE_DOCUMENTS.map((d) => d.key));
    for (const key of DOCUMENT_FALLBACKS) expect(keys.has(key), key).toBe(true);
    const owned = CATALOGUE_DOCUMENTS.filter((d) => hasOwnDocumentIcon(d.key)).length;
    expect(owned + DOCUMENT_FALLBACKS.length).toBe(CATALOGUE_DOCUMENTS.length);
  });

  it('knows every label and alias of a catalogue type as the type itself', () => {
    for (const document of CATALOGUE_DOCUMENTS) {
      const expected = documentMark(document.key);
      expect(documentMark(document.label), `${document.key} by label`).toEqual(expected);
      for (const alias of document.aliases ?? []) {
        expect(documentMark(alias), `${document.key} by alias ${alias}`).toEqual(expected);
      }
    }
    expect(documentMark('National ID Card').icon).toBe('docId');
    expect(documentMark('NATIONAL_ID').icon).toBe('docId');
  });

  it('reads a typed name the way it reads the stored key', () => {
    expect(documentKey(' Bank statement ')).toBe('BANK_STATEMENT');
    expect(documentMark('Bank Statement')).toEqual(documentMark('BANK_STATEMENT'));
    expect(documentMark('PASSPORT')).toEqual({ icon: 'docPassport', tone: 'blue' });
    expect(documentMark('BANK_STATEMENT')).toEqual({ icon: 'docBank', tone: 'teal' });
    expect(documentMark('SOMETHING_NEW')).toEqual({ icon: GENERIC_DOCUMENT_ICON, tone: 'violet' });
    expect(documentMark(null).icon).toBe(GENERIC_DOCUMENT_ICON);
  });
});

describe('trip purposes', () => {
  it('has the purposes it is mapping', () => {
    expect(CATALOGUE_PURPOSES.length).toBeGreaterThan(100);
  });

  it('gives every purpose a picture and a kind tone', () => {
    for (const purpose of CATALOGUE_PURPOSES) {
      const mark = purposeMark(purpose.key, purpose.family);
      expect(ICON_NAMES, purpose.key).toContain(mark.icon);
      expect(KIND_TONES, purpose.key).toContain(mark.tone);
    }
  });

  it('counts and lists the purposes that read as their family picture', () => {
    const byFamily = CATALOGUE_PURPOSES.filter((p) => !hasOwnPurposeIcon(p.key));
    expect(byFamily.length).toBeLessThan(CATALOGUE_PURPOSES.length);
  });

  it('draws the eight purposes a traveller meets first, each differently', () => {
    const eight = {
      tourism: 'tripTourist',
      business_visit: 'briefcase',
      bachelors_or_masters_degree: 'tripStudy',
      employer_sponsored_skilled_job: 'tripWork',
      medical_treatment: 'tripMedical',
      family_or_friends_visit: 'tripFamily',
      religious_travel: 'tripPilgrim',
      transit_or_airside_transit: 'tripTransit',
    } as const;
    const seen = new Set<string>();
    for (const [key, icon] of Object.entries(eight)) {
      const purpose = CATALOGUE_PURPOSES.find((p) => p.key === key);
      expect(purpose, key).toBeDefined();
      expect(purposeMark(key, purpose?.family).icon, key).toBe(icon);
      seen.add(icon);
    }
    expect(seen.size).toBe(8);
  });

  it('maps every family, and reads an unknown purpose as the globe', () => {
    for (const family of PURPOSE_FAMILIES) {
      expect(ICON_NAMES).toContain(PURPOSE_FAMILY_ICON[family]);
    }
    expect(new Set(CATALOGUE_PURPOSES.map((p) => p.family))).toEqual(new Set(PURPOSE_FAMILIES));
    expect(purposeMark('not_a_purpose').icon).toBe('globe');
  });
});

describe('status words', () => {
  it('gives every chip word a picture', () => {
    const missing = [...CHIP_WORDS].filter((word) => !(word in STATUS_ICON_BY_WORD));
    expect(missing).toEqual([]);
  });

  it('keeps green, amber and red for state and never paints a state in a kind colour', () => {
    expect(toneName('success')).toBe('green');
    expect(toneName('warning')).toBe('amber');
    expect(toneName('danger')).toBe('red');
    expect(toneName('info')).toBe('blue');
    expect(toneName('neutral')).toBe('neutral');
    for (const tone of STATE_TONES) expect(KIND_TONES).not.toContain(tone);
    for (const word of Object.keys(STATUS_ICON_BY_WORD)) {
      for (const tone of ['success', 'warning', 'danger', 'info', 'neutral'] as const) {
        const mark = statusMark(word, tone);
        if (mark) expect(['green', 'amber', 'red', 'blue', 'neutral']).toContain(mark.tone);
      }
    }
    expect(statusMark('Not A Status', 'danger')).toBeUndefined();
  });

  it('keeps a symbol to one meaning: done is only ever green, received is only ever blue', () => {
    const tones = (icon: string) =>
      new Set(
        Object.entries(STATUS_ICON_BY_WORD)
          .filter(([, i]) => i === icon)
          .map(([word]) => word),
      );
    const doneWords = tones('stateDone');
    for (const word of doneWords) {
      expect([
        'On File',
        'Covered by Another Option',
        'Chosen',
        'Active',
        'Accepted',
        'Ready to Submit',
      ]).toContain(word);
    }
    expect(tones('stateReceived')).toEqual(new Set(['Received', 'Submitted']));
  });
});

describe('a symbol never contradicts its chip', () => {
  const real: StatusWord[] = [
    ...Object.values(REQUIREMENT_STATUS),
    COVERED_STATUS,
    FRESHNESS_UNKNOWN_STATUS,
    ...Object.values(GRANT_STATUS),
    ...Object.values(INVITATION_STATUS),
  ];

  it('gives every real chip its symbol in the tone it really has', () => {
    for (const status of real) {
      expect(statusIconFor(status.word, status.tone), `${status.word} (${status.tone})`).toBe(
        statusIcon(status.word),
      );
    }
  });

  it('withholds the symbol when the tone disagrees with it', () => {
    expect(statusIconFor('Pending', 'info')).toBe('stateWaiting');
    expect(statusIconFor('Pending', 'danger')).toBeUndefined();
    expect(statusIconFor('On File', 'warning')).toBeUndefined();
    expect(statusMark('Active', 'danger')).toBeUndefined();
  });
});

describe('one symbol, one meaning', () => {
  const documentSet = new Set<string>(DOCUMENT_ICONS);
  const purposeSet = new Set<string>([
    ...Object.values(PURPOSE_FAMILY_ICON),
    'tripFamily',
    'tripPilgrim',
    'tripMedical',
    'tripTransit',
    'briefcase',
    'building',
  ]);
  const statusSet = new Set<string>(Object.values(STATUS_ICON_BY_WORD));
  const shared = new Set<string>(SHARED_ON_PURPOSE.map((s) => s.icon));

  it('never shares a symbol between a document kind, a purpose and a status', () => {
    const overlaps: string[] = [];
    for (const icon of documentSet) {
      if (purposeSet.has(icon) || statusSet.has(icon)) overlaps.push(icon);
    }
    for (const icon of purposeSet) if (statusSet.has(icon)) overlaps.push(icon);
    expect(overlaps.filter((icon) => !shared.has(icon))).toEqual([]);
  });

  it('draws every picture differently', () => {
    const drawings = new Map<string, string>();
    for (const name of ICON_NAMES) {
      const shapes = iconDrawing(name);
      const twin = drawings.get(shapes);
      expect(twin, `${name} is drawn like ${twin}`).toBeUndefined();
      drawings.set(shapes, name);
    }
  });
});

describe('colour', () => {
  const css = readFileSync(join(__dirname, '..', 'app', 'globals.css'), 'utf8');
  const start = css.indexOf('/* WP-P13 ');
  const end = css.indexOf('/* end WP-P13 */');

  it('has its own style block', () => {
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
  });

  it('writes no colour value in the picture styles: tones come from the six Harbor tokens', () => {
    const block = css.slice(start, end).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(block).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(block).not.toMatch(/\b(?:rgb|rgba|hsl|hsla|oklch|lab|color-mix)\(/i);
    expect(block).not.toMatch(/gradient|box-shadow|text-shadow|filter:|drop-shadow/i);
    // Every colour it uses is a variable that already exists.
    for (const [, name] of block.matchAll(/var\((--[a-z0-9-]+)/g)) {
      expect(css, name).toMatch(new RegExp(`${name}\\s*:`));
    }
  });
});
