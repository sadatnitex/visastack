import { type StarterNecessity, mapDocType, necessityFor } from './doc-type-rules';

/**
 * Starter checklists: what an agency's own country files say, turned into checklist definitions
 * that Pack Studio can hold. Nothing here is official. The words are the agency's, kept exactly as
 * written; the type and the necessity are a reading of them that an admin can change.
 */

/** One line of the sheet, as it is written there. */
export interface StarterSheetRow {
  readonly country: string;
  readonly purpose: string;
  readonly appliesWhen: string;
  readonly text: string;
  readonly keep: string;
  readonly reference: string;
}

export type StarterPurpose = 'tourist' | 'business' | 'medical';

export interface StarterRequirement {
  /** The sentence from the sheet, as written. */
  readonly text: string;
  readonly docType: string;
  readonly necessity: StarterNecessity;
  /** Who the item is for: "All applicants", "Employee", "Student"... as written. */
  readonly appliesWhen: string;
  /** The file the line came from, as written in the sheet. */
  readonly reference: string;
}

export interface StarterPackDefinition {
  /** Always `starter.<iso2>.<purpose>`. */
  readonly key: string;
  readonly name: string;
  readonly description: string;
  /** The two-letter country code, one of the names a case matches on. */
  readonly jurisdiction: string;
  /** The purpose key a case matches on (`tourism`, `business_visit`, `medical_treatment`). */
  readonly purpose: string;
  readonly starterPurpose: StarterPurpose;
  readonly requirements: readonly StarterRequirement[];
  /** A fingerprint of the content, so a later import can tell whether anything changed. */
  readonly contentHash: string;
}

export interface StarterBuildResult {
  readonly packs: readonly StarterPackDefinition[];
  /** Lines left out, each with the plain reason. */
  readonly skipped: readonly { readonly row: StarterSheetRow; readonly reason: string }[];
}

/** The key prefix that marks a starter checklist. The one place that says so. */
export const STARTER_KEY_PREFIX = 'starter.';

export function isStarterPackKey(key: string | null | undefined): boolean {
  return typeof key === 'string' && key.startsWith(STARTER_KEY_PREFIX);
}

/** The words every starter checklist carries, so no one reads it as official. */
export const STARTER_NOTICE =
  'Starter list from agency files. Not official. Check the official page.';

/** The two-letter codes of the countries in the supplied sheet, by the name the sheet uses. */
const COUNTRY_CODES: Readonly<Record<string, string>> = {
  Australia: 'AU',
  Canada: 'CA',
  China: 'CN',
  Denmark: 'DK',
  Egypt: 'EG',
  France: 'FR',
  Germany: 'DE',
  'Hong Kong': 'HK',
  Hungary: 'HU',
  India: 'IN',
  Indonesia: 'ID',
  Italy: 'IT',
  Japan: 'JP',
  Malaysia: 'MY',
  Morocco: 'MA',
  Myanmar: 'MM',
  Nepal: 'NP',
  'New Zealand': 'NZ',
  Nigeria: 'NG',
  Philippines: 'PH',
  Singapore: 'SG',
  'South Africa': 'ZA',
  'South Korea': 'KR',
  Spain: 'ES',
  'Sri Lanka': 'LK',
  Sweden: 'SE',
  Switzerland: 'CH',
  Thailand: 'TH',
  Türkiye: 'TR',
  Turkey: 'TR',
  'United Arab Emirates': 'AE',
  'United Kingdom': 'GB',
  'United States': 'US',
  Vietnam: 'VN',
};

const PURPOSES: Readonly<
  Record<StarterPurpose, { readonly key: string; readonly label: string; readonly sheet: RegExp }>
> = {
  tourist: { key: 'tourism', label: 'Tourist', sheet: /^tourist/i },
  business: { key: 'business_visit', label: 'Business', sheet: /^business/i },
  medical: { key: 'medical_treatment', label: 'Medical', sheet: /^medical/i },
};

function purposeOf(sheetPurpose: string): StarterPurpose | null {
  for (const [name, purpose] of Object.entries(PURPOSES) as [
    StarterPurpose,
    (typeof PURPOSES)[StarterPurpose],
  ][]) {
    if (purpose.sheet.test(sheetPurpose.trim())) return name;
  }
  return null;
}

/** Whether two lines are the same word for word, for who they are for and where they came from too. */
export function sameLine(a: StarterRequirement, b: StarterRequirement): boolean {
  return (
    a.text === b.text &&
    a.docType === b.docType &&
    a.appliesWhen === b.appliesWhen &&
    a.reference === b.reference
  );
}

/** A short stable fingerprint of text (FNV-1a, 32 bits), enough to notice a change. */
function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

/**
 * A fingerprint of a list's content that does not depend on the order lines are stored in, so a
 * later import can tell whether anything changed. Each line counts by its words, type, necessity,
 * who it is for and the file it came from.
 */
export function starterContentHash(
  requirements: readonly Pick<
    StarterRequirement,
    'text' | 'docType' | 'necessity' | 'appliesWhen' | 'reference'
  >[],
): string {
  return fingerprint(
    requirements
      .map((r) => [r.text, r.docType, r.necessity, r.appliesWhen, r.reference].join('\u0001'))
      .sort()
      .join('\u0002'),
  );
}

/** Dashes and spaces a sheet may carry, written the plain way. */
export function plainText(text: string): string {
  return text.replace(/[–—]/g, '-').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * The checklists a sheet describes: one Tourist list per country (the base), and for a country
 * that has extra items, a Business list and a Medical list that are the base plus those extras,
 * because a case holds one list and the extras are for that purpose only. Lines marked not to keep
 * are left out and reported. Every list keeps the sheet's order.
 */
export function buildStarterPacks(rows: readonly StarterSheetRow[]): StarterBuildResult {
  const skipped: { row: StarterSheetRow; reason: string }[] = [];
  const base = new Map<string, StarterRequirement[]>();
  const extras = new Map<string, StarterRequirement[]>();
  const countries: string[] = [];

  for (const row of rows) {
    const text = plainText(row.text);
    if (text.length === 0) {
      skipped.push({ row, reason: 'The line is empty.' });
      continue;
    }
    if (!/^yes$/i.test(row.keep.trim())) {
      skipped.push({ row, reason: 'The sheet marks this line not to keep.' });
      continue;
    }
    const iso2 = COUNTRY_CODES[row.country.trim()];
    if (!iso2) {
      skipped.push({ row, reason: `The country "${row.country}" is not one we know yet.` });
      continue;
    }
    const purpose = purposeOf(row.purpose);
    if (!purpose) {
      skipped.push({
        row,
        reason: `The purpose "${row.purpose}" is not Tourist, Business or Medical.`,
      });
      continue;
    }
    const docType = mapDocType(text);
    const requirement: StarterRequirement = {
      text,
      docType,
      necessity: necessityFor(row.appliesWhen, docType, text),
      appliesWhen: plainText(row.appliesWhen),
      reference: plainText(row.reference),
    };
    if (!countries.includes(iso2)) countries.push(iso2);
    const bucket = purpose === 'tourist' ? base : extras;
    const id = purpose === 'tourist' ? iso2 : `${iso2}.${purpose}`;
    const already = bucket.get(id) ?? [];
    if (already.some((line) => sameLine(line, requirement))) {
      skipped.push({ row, reason: 'The same line is already in this list.' });
      continue;
    }
    bucket.set(id, [...already, requirement]);
  }

  const packs: StarterPackDefinition[] = [];
  const nameOf = (iso2: string) =>
    Object.entries(COUNTRY_CODES).find(([, code]) => code === iso2)?.[0] ?? iso2;
  for (const iso2 of countries) {
    const baseList = base.get(iso2) ?? [];
    const variants: [StarterPurpose, readonly StarterRequirement[]][] = [['tourist', baseList]];
    for (const purpose of ['business', 'medical'] as const) {
      const extra = extras.get(`${iso2}.${purpose}`);
      // A line the sheet repeats under an extra purpose, word for word, is already in the base.
      const own = extra?.filter((line) => !baseList.some((b) => sameLine(b, line))) ?? [];
      if (own.length > 0) variants.push([purpose, [...baseList, ...own]]);
    }
    for (const [purpose, requirements] of variants) {
      if (requirements.length === 0) continue;
      const meta = PURPOSES[purpose];
      const hash = starterContentHash(requirements);
      packs.push({
        key: `${STARTER_KEY_PREFIX}${iso2.toLowerCase()}.${purpose}`,
        name: `${nameOf(iso2) === 'Turkey' ? 'Türkiye' : nameOf(iso2)} ${meta.label} Starter List`,
        description: STARTER_NOTICE,
        jurisdiction: iso2,
        purpose: meta.key,
        starterPurpose: purpose,
        requirements,
        contentHash: hash,
      });
    }
  }
  return { packs, skipped };
}

export { mapDocType, necessityFor };
