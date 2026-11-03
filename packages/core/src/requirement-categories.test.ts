import { describe, expect, it } from 'vitest';
import { PROPOSED_PACK_KEYS } from './catalogue/types';
import { PROFILE_PACKS } from './domain';
import {
  ACCEPTED_FORMS,
  NO_FORMAT_RULES,
  REQUIREMENT_CATEGORIES,
  REQUIREMENT_CATEGORY_LABELS,
  UNCATEGORISED_LABEL,
  groupByRequirementCategory,
  requirementFormatLines,
} from './requirement-categories';
import {
  PROVENANCE_LABELS,
  REQUIREMENT_NECESSITIES,
  REQUIREMENT_PROVENANCES,
  isOfficialProvenance,
  provenanceAllowsNecessity,
} from './requirement-necessity';

const lower = (values: readonly string[]) => values.map((v) => v.toLowerCase());

describe('requirement categories (UMPE G2, R02)', () => {
  it('share nothing with the sharing categories or the profile packs', () => {
    const sharing = new Set(lower([...PROFILE_PACKS, ...PROPOSED_PACK_KEYS]));
    for (const category of lower(REQUIREMENT_CATEGORIES)) expect(sharing.has(category)).toBe(false);
    const labels = new Set(lower(Object.values(REQUIREMENT_CATEGORY_LABELS)));
    for (const key of sharing) expect(labels.has(key)).toBe(false);
  });

  it('are one flat list with a distinct heading each (no duplicated primary category)', () => {
    expect(new Set(REQUIREMENT_CATEGORIES).size).toBe(REQUIREMENT_CATEGORIES.length);
    const labels = Object.values(REQUIREMENT_CATEGORY_LABELS);
    expect(new Set(labels).size).toBe(labels.length);
    expect(Object.keys(REQUIREMENT_CATEGORY_LABELS).sort()).toEqual(
      [...REQUIREMENT_CATEGORIES].sort(),
    );
    expect(labels).not.toContain(UNCATEGORISED_LABEL);
  });

  it('groups rows in the fixed order, uncategorised last, keeping row order', () => {
    const rows = [
      { id: 'a', c: null },
      { id: 'b', c: 'FINANCIAL_MEANS' as const },
      { id: 'c', c: 'IDENTITY_TRAVEL_DOCUMENTS' as const },
      { id: 'd', c: 'FINANCIAL_MEANS' as const },
    ];
    const groups = groupByRequirementCategory(rows, (r) => r.c);
    expect(groups.map((g) => g.label)).toEqual([
      'Identity and Travel Documents',
      'Money and Proof of Funds',
      UNCATEGORISED_LABEL,
    ]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(['b', 'd']);
  });
});

describe('field observations (UMPE G2, S08)', () => {
  it('are labelled as observations and never as an official requirement', () => {
    expect(REQUIREMENT_PROVENANCES).toContain('FIELD_OBSERVATION');
    expect(PROVENANCE_LABELS.FIELD_OBSERVATION).toBe('Observed in VisaStack Cases');
    expect(PROVENANCE_LABELS.FIELD_OBSERVATION.toLowerCase()).not.toContain('official');
    expect(isOfficialProvenance('FIELD_OBSERVATION')).toBe(false);
    expect(REQUIREMENT_PROVENANCES.filter(isOfficialProvenance)).toEqual(['OFFICIAL']);
  });

  it('may only be Recommended or Optional', () => {
    expect(
      REQUIREMENT_NECESSITIES.filter((n) => provenanceAllowsNecessity('FIELD_OBSERVATION', n)),
    ).toEqual(['RECOMMENDED', 'OPTIONAL']);
    for (const n of REQUIREMENT_NECESSITIES)
      expect(provenanceAllowsNecessity('OFFICIAL', n)).toBe(true);
  });
});

describe('document format lines (UMPE G2, R12)', () => {
  it('shows structured rules', () => {
    expect(
      requirementFormatLines(
        {
          acceptedForm: 'CERTIFIED_COPY',
          translationNeeded: true,
          originalNeeded: true,
          statementPeriodMonths: 6,
          validMonthsAfterTravel: 3,
        },
        null,
        90,
      ),
    ).toEqual([
      'Accepted As: Certified Copy',
      'Original Needed',
      'Translation Needed',
      'Must Cover the Last 6 Months',
      'Dated Within 90 Days',
      'Valid 3 Months After Your Trip Ends',
    ]);
    expect(ACCEPTED_FORMS).toHaveLength(4);
  });

  it('falls back to the notes only when the structured value is unset', () => {
    const notes = 'Bring the original. A certified translation is needed.';
    expect(requirementFormatLines(NO_FORMAT_RULES, notes, null)).toEqual([
      'Checklist Notes Mention Originals',
      'Checklist Notes Mention a Translation',
    ]);
    expect(
      requirementFormatLines(
        { ...NO_FORMAT_RULES, translationNeeded: false, originalNeeded: false },
        notes,
        null,
      ),
    ).toEqual([]);
    expect(requirementFormatLines(NO_FORMAT_RULES, null, null)).toEqual([]);
    expect(
      requirementFormatLines(NO_FORMAT_RULES, 'Bring the originals and one photocopy.', null),
    ).toEqual(['Checklist Notes Mention Originals']);
    expect(requirementFormatLines(NO_FORMAT_RULES, 'Notarised copies accepted.', null)).toEqual([]);
    expect(requirementFormatLines(NO_FORMAT_RULES, 'No translation needed.', null)).toEqual([]);
  });
});
