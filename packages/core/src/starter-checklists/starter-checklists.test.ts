import { describe, expect, it } from 'vitest';
import { CATALOGUE_DOCUMENTS } from '../catalogue/documents';
import { parseCsv } from '../csv';
import {
  STARTER_SEED_ROWS,
  buildStarterPacks,
  isOtherType,
  isOwnPassportLine,
  isStarterPackKey,
  mapDocType,
  necessityFor,
  readStarterSheet,
  starterSheetCsv,
} from './index';

const DASH = String.fromCharCode(0x2014);
const KNOWN_TYPES = new Set(CATALOGUE_DOCUMENTS.map((d) => d.key));

describe('the supplied country checklists', () => {
  const built = buildStarterPacks(STARTER_SEED_ROWS);

  it('builds every line of the sheet, leaving none out', () => {
    expect(STARTER_SEED_ROWS).toHaveLength(485);
    expect(built.skipped).toEqual([]);
    const lines = built.packs.reduce((sum, pack) => sum + pack.requirements.length, 0);
    // Business and Medical lists repeat the base, so there are more lines than sheet rows.
    expect(lines).toBeGreaterThan(485);
  });

  it('makes one Tourist list for each of the 33 countries and extras only where the sheet has them', () => {
    const tourist = built.packs.filter((p) => p.starterPurpose === 'tourist');
    expect(tourist).toHaveLength(33);
    const extraRows = STARTER_SEED_ROWS.filter((r) => !/^tourist/i.test(r.purpose));
    const businessCountries = new Set(
      extraRows.filter((r) => /^business/i.test(r.purpose)).map((r) => r.country),
    );
    const medicalCountries = new Set(
      extraRows.filter((r) => /^medical/i.test(r.purpose)).map((r) => r.country),
    );
    expect(built.packs.filter((p) => p.starterPurpose === 'business')).toHaveLength(
      businessCountries.size,
    );
    expect(built.packs.filter((p) => p.starterPurpose === 'medical')).toHaveLength(
      medicalCountries.size,
    );
  });

  it('names every list so it cannot be read as official, and keys it as a starter list', () => {
    const keys = new Set<string>();
    for (const pack of built.packs) {
      expect(pack.key).toMatch(/^starter\.[a-z]{2}\.(tourist|business|medical)$/);
      expect(isStarterPackKey(pack.key)).toBe(true);
      expect(pack.name).toMatch(/ (Tourist|Business|Medical) Starter List$/);
      expect(pack.description).toContain('Not official');
      expect(pack.jurisdiction).toMatch(/^[A-Z]{2}$/);
      expect(['tourism', 'business_visit', 'medical_treatment']).toContain(pack.purpose);
      expect(keys.has(pack.key)).toBe(false);
      keys.add(pack.key);
    }
  });

  it('gives every line a document type the catalogue knows (or Other) and a necessity', () => {
    for (const pack of built.packs) {
      for (const requirement of pack.requirements) {
        expect(
          KNOWN_TYPES.has(requirement.docType),
          `${requirement.docType}: ${requirement.text}`,
        ).toBe(true);
        expect(['MANDATORY', 'RECOMMENDED', 'OPTIONAL']).toContain(requirement.necessity);
        expect(requirement.text.length).toBeGreaterThan(0);
        expect(requirement.reference.length).toBeGreaterThan(0);
      }
    }
  });

  it("never makes an item Required unless it is for every applicant (or is the traveller's own passport) and names a real document", () => {
    for (const pack of built.packs) {
      for (const requirement of pack.requirements) {
        if (requirement.necessity !== 'MANDATORY') continue;
        if (!isOwnPassportLine(requirement.docType, requirement.text)) {
          expect(requirement.appliesWhen.toLowerCase()).toBe('all applicants');
        }
        expect(isOtherType(requirement.docType)).toBe(false);
      }
    }
  });

  it("makes the traveller's own passport Required on every list, whatever the sheet says about who it is for", () => {
    let seen = 0;
    for (const pack of built.packs) {
      for (const requirement of pack.requirements) {
        if (!isOwnPassportLine(requirement.docType, requirement.text)) continue;
        seen += 1;
        expect(requirement.necessity, `${pack.key}: ${requirement.text}`).toBe('MANDATORY');
      }
    }
    expect(seen).toBeGreaterThan(40);
  });

  it("does not make someone else's passport, the lost passport diary or a photograph Required because of the passport rule", () => {
    const NOT_FORCED = [
      /signatory/i,
      /^Host /i,
      /Host passport/i,
      /lost-passport/i,
      /should match the passport/i,
      /passport photograph/i,
      /passport-style photograph/i,
    ];
    let checked = 0;
    for (const pack of built.packs) {
      for (const requirement of pack.requirements) {
        if (!NOT_FORCED.some((pattern) => pattern.test(requirement.text))) continue;
        checked += 1;
        expect(isOwnPassportLine(requirement.docType, requirement.text), requirement.text).toBe(
          false,
        );
        // Only a line that is for every applicant under the ordinary rule may be Required.
        if (requirement.necessity === 'MANDATORY') {
          expect(requirement.appliesWhen.toLowerCase(), requirement.text).toBe('all applicants');
        }
      }
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("every list that names the traveller's own passport has it Required", () => {
    const withPassport = built.packs.filter((pack) =>
      pack.requirements.some((r) => isOwnPassportLine(r.docType, r.text)),
    );
    expect(withPassport.length).toBeGreaterThan(20);
    for (const pack of withPassport) {
      expect(
        pack.requirements.some(
          (r) => isOwnPassportLine(r.docType, r.text) && r.necessity === 'MANDATORY',
        ),
        pack.key,
      ).toBe(true);
    }
  });

  it('writes no long dash, and keeps the sheet order inside a list', () => {
    for (const pack of built.packs) {
      for (const requirement of pack.requirements) {
        expect(requirement.text).not.toContain(DASH);
        expect(requirement.text).not.toContain('–');
      }
    }
    const australia = built.packs.find((p) => p.key === 'starter.au.tourist');
    const rows = STARTER_SEED_ROWS.filter(
      (r) => r.country === 'Australia' && /^tourist/i.test(r.purpose),
    );
    expect(australia?.requirements.map((r) => r.text.slice(0, 20))).toEqual(
      rows.map((r) => r.text.replace(/\s+/g, ' ').trim().slice(0, 20)),
    );
  });

  it('writes the lists back as a sheet and reads them to the same lists', () => {
    const csv = starterSheetCsv(built.packs);
    const read = readStarterSheet(csv);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    const again = buildStarterPacks(read.rows);
    expect(again.packs.map((p) => [p.key, p.contentHash])).toEqual(
      built.packs.map((p) => [p.key, p.contentHash]),
    );
  });
});

describe('reading a document type from a sentence', () => {
  it('names the first document in the sentence', () => {
    expect(mapDocType('Six (6) Months Bank Statement and Solvency')).toBe('BANK_STATEMENT');
    expect(mapDocType('Solvency certificate and bank statement')).toBe('SOLVENCY_CERTIFICATE');
    expect(mapDocType('Two recent colour photos, white background')).toBe('PHOTO');
    expect(mapDocType('Original passport and all previous passports.')).toBe('PASSPORT');
    expect(mapDocType('Covid Vaccine Certificate.')).toBe('COVID_CERTIFICATE');
  });

  it('leaves an instruction, or a sentence naming no document, as Other', () => {
    expect(mapDocType('Bring original documents and one photocopy set.')).toBe('OTHER');
    expect(mapDocType('Translate non-English documents and provide legible colour scans.')).toBe(
      'OTHER',
    );
  });
});

describe('how necessary a line is', () => {
  it('is Required only for every applicant with a real document, and always for the passport', () => {
    expect(necessityFor('All applicants', 'PASSPORT')).toBe('MANDATORY');
    const own =
      'Original Passport 6 Months Validity. [If Have Old Passport, Must Be Taken With It]';
    expect(necessityFor('As applicable', 'PASSPORT', own)).toBe('MANDATORY');
    expect(necessityFor('Student', 'PASSPORT', 'Current passport with six months validity')).toBe(
      'MANDATORY',
    );
    expect(necessityFor('', 'PASSPORT', 'Passport.')).toBe('MANDATORY');
    // Not the traveller's own passport: the ordinary rule applies.
    expect(
      necessityFor(
        'Business traveller',
        'PASSPORT',
        "Copy of the Italian signatory's passport or identity document.",
      ),
    ).not.toBe('MANDATORY');
    expect(
      necessityFor(
        'Visiting family / friends',
        'PASSPORT',
        'Host passport/ID and resident permit copy if applicable.',
      ),
    ).not.toBe('MANDATORY');
    expect(
      necessityFor(
        'If passport was lost',
        'PASSPORT',
        'General diary (GD) and lost-passport certificate if applicable.',
      ),
    ).toBe('OPTIONAL');
    expect(
      necessityFor(
        'As applicable',
        'PASSPORT',
        'Applicant name and parents names on supporting documents should match the passport.',
      ),
    ).toBe('OPTIONAL');
    expect(necessityFor('As applicable', 'PHOTO')).toBe('OPTIONAL');
    expect(necessityFor('Employee', 'NOC_EMPLOYER')).toBe('RECOMMENDED');
    expect(necessityFor('As applicable', 'TAX_RETURN')).toBe('OPTIONAL');
    expect(necessityFor('All applicants', 'OTHER')).toBe('OPTIONAL');
  });

  it('believes the sentence when it says the item is not mandatory', () => {
    expect(
      necessityFor(
        'All applicants',
        'INVITATION_LETTER',
        'Invitation letter (Not mandatory for tourist visa)',
      ),
    ).toBe('OPTIONAL');
    expect(
      necessityFor(
        'All applicants',
        'TRAVEL_INSURANCE',
        'Travel health insurance if requested or held.',
      ),
    ).toBe('OPTIONAL');
  });
});

describe('reading a sheet', () => {
  it('skips title lines above the header and asks for the header when it is missing', () => {
    const ok = readStarterSheet(
      'Title\n\nCountry,Purpose,Applies when,Document / requirement,Keep?,Reference file\nJapan,Tourist (base),All applicants,"A, quoted",Yes,Japan.pdf\n',
    );
    expect(ok.ok && ok.rows).toEqual([
      {
        country: 'Japan',
        purpose: 'Tourist (base)',
        appliesWhen: 'All applicants',
        text: 'A, quoted',
        keep: 'Yes',
        reference: 'Japan.pdf',
      },
    ]);
    const bad = readStarterSheet('a,b\n1,2\n');
    expect(bad.ok).toBe(false);
  });

  it('reports a line it cannot place instead of dropping it silently', () => {
    const built = buildStarterPacks([
      {
        country: 'Atlantis',
        purpose: 'Tourist (base)',
        appliesWhen: 'All applicants',
        text: 'Passport',
        keep: 'Yes',
        reference: 'x',
      },
      {
        country: 'Japan',
        purpose: 'Study',
        appliesWhen: 'All applicants',
        text: 'Passport',
        keep: 'Yes',
        reference: 'x',
      },
      {
        country: 'Japan',
        purpose: 'Tourist (base)',
        appliesWhen: 'All applicants',
        text: 'Passport',
        keep: 'No',
        reference: 'x',
      },
    ]);
    expect(built.packs).toEqual([]);
    expect(built.skipped.map((s) => s.reason)).toEqual([
      expect.stringContaining('Atlantis'),
      expect.stringContaining('Study'),
      expect.stringContaining('not to keep'),
    ]);
  });
});

describe('the CSV reader', () => {
  it('handles quotes, commas, line breaks and both line endings', () => {
    expect(parseCsv('a,"b,c","d ""e""",f\r\n"g\nh",i\n')).toEqual([
      ['a', 'b,c', 'd "e"', 'f'],
      ['g\nh', 'i'],
    ]);
  });
});

describe('the sheet reader on a downloaded sheet', () => {
  const header = 'Country,Purpose,Applies when,Document / requirement,Keep?,Reference file';

  it('takes the protective apostrophe off a cell that began like a formula', () => {
    const read = readStarterSheet(
      `${header}\nJapan,Tourist,All applicants,"'=Bank letter",Yes,file.pdf\n`,
    );
    expect(read.ok && read.rows[0]?.text).toBe('=Bank letter');
  });

  it('keeps a plain leading apostrophe that guards nothing', () => {
    const read = readStarterSheet(
      `${header}\nJapan,Tourist,All applicants,'Quoted word,Yes,file.pdf\n`,
    );
    expect(read.ok && read.rows[0]?.text).toBe("'Quoted word");
  });

  it('treats a Keep? cell holding only spaces as Yes', () => {
    const read = readStarterSheet(
      `${header}\nJapan,Tourist,All applicants,Passport,   ,file.pdf\n`,
    );
    expect(read.ok && read.rows[0]?.keep).toBe('Yes');
  });
});
