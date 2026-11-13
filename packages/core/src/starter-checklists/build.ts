import { DESTINATIONS, COUNTRY_CODES as ISO_COUNTRY_CODES } from '../destinations';
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

/**
 * Names a sheet may use that the country intake spells differently. Every other name is read
 * through the intake below.
 */
const NAME_ALIASES: Readonly<Record<string, string>> = {
  'Hong Kong': 'HK',
  Turkey: 'TR',
};

let intakeCodes: ReadonlyMap<string, string> | undefined;

/**
 * A country by the name the country intake sheets use (batch-001, 156 countries), taking a code
 * only if the ISO table (`country-codes.json`) has it. That table holds codes only, no names, so
 * the names come from the intake, which is the owner's own list.
 */
function intakeCodeOf(name: string): string | undefined {
  if (intakeCodes === undefined) {
    const iso = new Set(ISO_COUNTRY_CODES.map(([alpha2]) => alpha2));
    intakeCodes = new Map(
      DESTINATIONS.filter((destination) => iso.has(destination.iso2)).map((destination) => [
        destination.country,
        destination.iso2,
      ]),
    );
  }
  return intakeCodes.get(name);
}

/** The two-letter code for a country name as a sheet writes it, or undefined when it is not known. */
export function starterCountryCode(name: string): string | undefined {
  const trimmed = name.trim();
  if (Object.hasOwn(NAME_ALIASES, trimmed)) return NAME_ALIASES[trimmed];
  return intakeCodeOf(trimmed);
}

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

/** The long dashes a sheet may carry (en and em), written as a plain hyphen. Built from code points so no source file holds one. */
const LONG_DASHES = new RegExp(
  `[${String.fromCharCode(0x2013)}${String.fromCharCode(0x2014)}]`,
  'g',
);
const NO_BREAK_SPACE = new RegExp(String.fromCharCode(0xa0), 'g');

/** Dashes and spaces a sheet may carry, written the plain way. */
export function plainText(text: string): string {
  return text.replace(LONG_DASHES, '-').replace(NO_BREAK_SPACE, ' ').replace(/\s+/g, ' ').trim();
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
  /** The name the sheet used first for each code. */
  const sheetNames = new Map<string, string>();

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
    const iso2 = starterCountryCode(row.country);
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
    if (!sheetNames.has(iso2)) sheetNames.set(iso2, row.country.trim());
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
  // A list is named as the sheet names its country; Turkey is written Türkiye, as the first sheet did.
  const nameOf = (iso2: string) => {
    const name = sheetNames.get(iso2) ?? iso2;
    return name === 'Turkey' ? 'Türkiye' : name;
  };
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
        name: `${nameOf(iso2)} ${meta.label} Starter List`,
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
