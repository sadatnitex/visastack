import {
  CATALOGUE_DOCUMENTS,
  CATALOGUE_MODULES,
  isKnownFieldKey,
  isKnownRecordGroupKey,
} from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import {
  type MasterProfileInput,
  buildMasterProfileView,
  completionOf,
  evidenceDocumentGroups,
  evidenceFieldGroups,
  fieldLabel,
  savableField,
} from './master-profile';

const none = (): MasterProfileInput => ({
  entries: [],
  activated: new Set(),
  notApplicable: new Set(),
  noneDeclared: new Set(),
  suggestFor: null,
});
const sectionsOf = (view: ReturnType<typeof buildMasterProfileView>) =>
  view.layers.flatMap((layer) => layer.sections);
const openable = CATALOGUE_MODULES.filter((module) => !module.internal);

describe('master profile view', () => {
  it('lists every openable section exactly once, with the common ones open and the rest locked', () => {
    const view = buildMasterProfileView(none());
    const sections = sectionsOf(view);
    expect(sections.map((section) => section.key).sort()).toEqual(
      openable.map((module) => module.key).sort(),
    );
    expect(view.totalSections).toBe(openable.length);
    const open = sections.filter((section) => section.open);
    expect(open.map((section) => section.key).sort()).toEqual(
      openable
        .filter((module) => module.defaultOpen)
        .map((module) => module.key)
        .sort(),
    );
    expect(view.openSections).toBe(open.length);
    // The owner's confirmed starting set: the common sections hold 54 counted details.
    expect(view.total).toBe(54);
    expect(view.percent).toBe(0);
  });

  it('keeps a locked section fully visible by name but never editable', () => {
    const view = buildMasterProfileView(none());
    const locked = sectionsOf(view).filter((section) => !section.open);
    expect(locked.length).toBeGreaterThan(50);
    for (const section of locked) {
      expect(section.previewLabels.length).toBe(section.detailCount);
      expect(section.singles).toHaveLength(0);
      expect(section.groups).toHaveLength(0);
      expect(section.total).toBe(0);
    }
  });

  it('adds an opened section to the calculation at once, and leaves the percentage honest', () => {
    const before = buildMasterProfileView(none());
    const target = sectionsOf(before).find((section) => !section.open && section.detailCount > 0);
    if (!target) throw new Error('no locked section');
    const after = buildMasterProfileView({ ...none(), activated: new Set([target.key]) });
    expect(after.total).toBe(before.total + target.detailCount);
    expect(after.openSections).toBe(before.openSections + 1);
    const opened = sectionsOf(after).find((section) => section.key === target.key);
    expect(opened?.open).toBe(true);
    expect(opened?.reason).toBe('opened');
    expect(opened?.canClose).toBe(true);
    expect(opened?.singles.length ?? 0).toBeGreaterThan(0);
  });

  it('counts a detail once it has a value, a "does not apply" mark, or a "none" mark', () => {
    const base = buildMasterProfileView(none());
    const withValue = buildMasterProfileView({
      ...none(),
      entries: [{ fieldKey: 'given_name', value: 'Rahim', status: 'DECLARED' }],
    });
    expect(withValue.answered).toBe(1);
    expect(withValue.percent).toBe(Math.round((100 * 1) / base.total));
    const withProtected = buildMasterProfileView({
      ...none(),
      entries: [{ fieldKey: 'date_of_birth', value: null, status: 'DECLARED' }],
    });
    expect(withProtected.answered).toBe(1);
    const withMark = buildMasterProfileView({ ...none(), notApplicable: new Set(['email']) });
    expect(withMark.answered).toBe(1);
    const withNone = buildMasterProfileView({
      ...none(),
      noneDeclared: new Set(['historical_passport']),
    });
    expect(withNone.answered).toBeGreaterThan(0);
  });

  it('never hides a section that already holds a detail, and does not let it be closed', () => {
    // Open every section once just to find a real detail inside a section that is locked by default.
    const everything = buildMasterProfileView({
      ...none(),
      activated: new Set(openable.map((module) => module.key)),
    });
    const lockedByDefault = new Set(
      openable.filter((module) => !module.defaultOpen).map((module) => module.key),
    );
    const sample = sectionsOf(everything)
      .filter((section) => lockedByDefault.has(section.key))
      .flatMap((section) =>
        section.singles.map((field) => ({ section: section.key, field: field.key })),
      )[0];
    if (!sample) throw new Error('no detail found in a locked section');

    const withData = buildMasterProfileView({
      ...none(),
      entries: [{ fieldKey: sample.field, value: 'x', status: 'DECLARED' }],
    });
    const section = sectionsOf(withData).find((candidate) => candidate.key === sample.section);
    expect(section?.open).toBe(true);
    expect(section?.reason).toBe('has_data');
    expect(section?.canClose).toBe(false);

    // Ticked on purpose and then filled in: it stays open on its own account, so it cannot be closed.
    const ticked = buildMasterProfileView({
      ...none(),
      activated: new Set([sample.section]),
      entries: [{ fieldKey: sample.field, value: 'x', status: 'DECLARED' }],
    });
    const tickedSection = sectionsOf(ticked).find((candidate) => candidate.key === sample.section);
    expect(tickedSection?.open).toBe(true);
    expect(tickedSection?.canClose).toBe(false);
    // Ticked and still empty: the person may close it again.
    const empty = buildMasterProfileView({ ...none(), activated: new Set([sample.section]) });
    expect(sectionsOf(empty).find((candidate) => candidate.key === sample.section)?.canClose).toBe(
      true,
    );
  });

  it('gives every choice that accepts Other its companion text box', () => {
    const view = buildMasterProfileView(none());
    const marital = sectionsOf(view)
      .flatMap((section) => section.singles)
      .find((field) => field.key === 'marital_status');
    expect(marital?.options).toContain('Other');
    expect(marital?.otherDetail?.key).toBe('marital_status_other');
    // The frozen live list is untouched: only the view adds Other.
    expect(marital?.options?.filter((option) => option === 'Other')).toHaveLength(1);
  });

  it('lists the documents that back an open section, what is on file, and which need the original', () => {
    const view = buildMasterProfileView({
      ...none(),
      activated: new Set(['bangladesh_tax']),
      uploadedDocumentTypes: new Map([['TAX_ACKNOWLEDGEMENT_SLIP', 2]]),
    });
    const tax = sectionsOf(view).find((section) => section.key === 'bangladesh_tax');
    const slip = tax?.documents?.find((document) => document.key === 'TAX_ACKNOWLEDGEMENT_SLIP');
    expect(slip).toEqual({
      key: 'TAX_ACKNOWLEDGEMENT_SLIP',
      label: 'Tax Return Acknowledgement Slip',
      original: true,
      uploaded: 2,
    });
    // Counts that were not loaded stay unknown, and a locked section lists no documents.
    const empty = sectionsOf(
      buildMasterProfileView({ ...none(), activated: new Set(['bangladesh_tax']) }),
    );
    expect(
      empty.find((section) => section.key === 'bangladesh_tax')?.documents?.[0]?.uploaded,
    ).toBeNull();
    for (const section of sectionsOf(buildMasterProfileView(none()))) {
      if (!section.open) expect(section.documents).toEqual([]);
    }
  });

  it('asks whether each income amount is before or after tax, right after it, without counting it', () => {
    const view = buildMasterProfileView({
      ...none(),
      activated: new Set(['self_employment']),
    });
    const keysOf = (key: string) =>
      sectionsOf(view)
        .find((section) => section.key === key)
        ?.singles.map((field) => field.key) ?? [];
    const income = keysOf('income_and_funding');
    expect(income.slice(0, 3)).toEqual([
      'annual_income',
      'annual_income_currency',
      'annual_income_tax_basis',
    ]);
    const salary = keysOf('employment');
    expect(salary.indexOf('monthly_salary_tax_basis')).toBe(
      salary.indexOf('monthly_salary_currency') + 1,
    );
    const self = keysOf('self_employment');
    expect(self.indexOf('self_employment_income_tax_basis')).toBe(
      self.indexOf('self_employment_income_currency') + 1,
    );
    const basis = sectionsOf(view)
      .flatMap((section) => section.singles)
      .find((field) => field.key === 'annual_income_tax_basis');
    expect(basis?.options).toEqual(['Before tax', 'After tax', 'Not sure']);
    // Blank already means not recorded and "Not sure" undoes a mistaken pick, so it offers no
    // "does not apply" control.
    expect(basis?.optional).toBe(true);
    // A section whose only answer is the tax basis keeps it visible: it cannot be closed.
    const onlyBasis = buildMasterProfileView({
      ...none(),
      activated: new Set(['self_employment']),
      entries: [
        { fieldKey: 'self_employment_income_tax_basis', value: 'After tax', status: 'DECLARED' },
      ],
    });
    expect(
      sectionsOf(onlyBasis).find((section) => section.key === 'self_employment')?.canClose,
    ).toBe(false);
    expect(basis?.label).toBe('Annual Income Before or After Tax');
    // Never counted: the default figure stays 54, and answering it adds nothing.
    expect(buildMasterProfileView(none()).total).toBe(54);
    const answered = completionOf(
      [{ fieldKey: 'annual_income_tax_basis', value: 'Before tax', status: 'DECLARED' }],
      { activated: new Set(), notApplicable: new Set(), noneDeclared: new Set() },
    );
    expect(answered.answered).toBe(0);
    // It saves with the amount's own category, so it is shared exactly where the amount is.
    expect(savableField('annual_income_tax_basis')?.packId).toBe('universal');
    expect(savableField('monthly_salary_tax_basis')?.packId).toBe('professional');
  });

  it('does not ask about tax when the amount does not apply, unless it was already answered', () => {
    const keysOf = (view: ReturnType<typeof buildMasterProfileView>) =>
      sectionsOf(view)
        .find((section) => section.key === 'employment')
        ?.singles.map((field) => field.key) ?? [];
    const exempt = buildMasterProfileView({
      ...none(),
      notApplicable: new Set(['monthly_salary']),
    });
    expect(keysOf(exempt)).not.toContain('monthly_salary_tax_basis');
    const answered = buildMasterProfileView({
      ...none(),
      notApplicable: new Set(['monthly_salary']),
      entries: [{ fieldKey: 'monthly_salary_tax_basis', value: 'After tax', status: 'DECLARED' }],
    });
    expect(keysOf(answered)).toContain('monthly_salary_tax_basis');
  });

  it('gives every section a free something-else record that points at real fields', () => {
    const view = buildMasterProfileView(none());
    for (const section of sectionsOf(view)) {
      expect(section.otherItem.fields).toHaveLength(4);
      expect(isKnownFieldKey(section.otherItem.sectionFieldKey)).toBe(true);
      for (const field of section.otherItem.fields) expect(isKnownFieldKey(field.key)).toBe(true);
    }
  });

  it('marks only locked sections that suit the chosen purpose, and ignores an unknown purpose', () => {
    const study = buildMasterProfileView({ ...none(), suggestFor: 'study' });
    const marked = sectionsOf(study).filter((section) => section.suggested);
    expect(study.suggestedFamily).toBe('study');
    expect(marked.length).toBe(study.suggestedLockedCount);
    for (const section of marked) {
      expect(section.open).toBe(false);
      const module = openable.find((candidate) => candidate.key === section.key);
      expect(module?.suggestedFor).toContain('study');
    }
    const bad = buildMasterProfileView({ ...none(), suggestFor: 'not_a_purpose' });
    expect(bad.suggestedFamily).toBeNull();
    expect(bad.suggestedLockedCount).toBe(0);
  });

  it('uses one completion number everywhere', () => {
    const input: MasterProfileInput = {
      ...none(),
      entries: [{ fieldKey: 'given_name', value: 'Rahim', status: 'DECLARED' }],
    };
    const view = buildMasterProfileView(input);
    expect(completionOf(input.entries, input)).toEqual({
      percent: view.percent,
      answered: view.answered,
      total: view.total,
    });
  });

  it('knows every record name it offers a "none" mark for', () => {
    const view = buildMasterProfileView({
      ...none(),
      activated: new Set(openable.map((m) => m.key)),
    });
    const groups = sectionsOf(view).flatMap((section) => section.groups);
    expect(groups.length).toBeGreaterThan(10);
    for (const group of groups) expect(isKnownRecordGroupKey(group.key)).toBe(true);
  });
});

describe('field lookups for saving and naming', () => {
  it('names live and added fields, and nothing else', () => {
    expect(fieldLabel('given_name')).toBeTruthy();
    expect(fieldLabel('marital_status_other')).toBe('Other Marital Status');
    expect(fieldLabel('made_up_field')).toBeUndefined();
  });

  it('describes a live field exactly as the registry does, and an added field from the catalogue', () => {
    const live = savableField('passport_number');
    expect(live?.packId).toBe('universal');
    expect(live?.sensitivity).toBeDefined();
    const added = savableField('other_item_study_title');
    expect(added?.packId).toBe('study');
    expect(added?.repeating).toBe(true);
    expect(savableField('made_up_field')).toBeUndefined();
  });
});

describe('what an agency can ask for', () => {
  const fields = evidenceFieldGroups().flatMap((group) => group.choices);

  it('offers every live detail and every detail the catalogue added, each once, by plain name', () => {
    const keys = fields.map((field) => field.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(fields.find((field) => field.key === 'passport_number')?.label).toBe('Passport Number');
    const added = keys.filter(
      (key) => !savableField(key) || savableField(key)?.packId !== 'universal',
    );
    expect(added.length).toBeGreaterThan(100);
    for (const key of keys) {
      expect(isKnownFieldKey(key)).toBe(true);
      expect(fieldLabel(key)).toBeTruthy();
    }
  });

  it('files each detail under the part of the profile it belongs to, with a plain group name', () => {
    for (const group of evidenceFieldGroups()) {
      expect(group.label).not.toMatch(/_/);
      for (const choice of group.choices) {
        expect(savableField(choice.key)?.packId ?? 'universal').toBe(group.key);
      }
    }
    expect(evidenceFieldGroups().some((group) => group.key === 'study')).toBe(true);
  });

  it('never offers the boxes that only hold "something else" text', () => {
    expect(fields.some((field) => field.key.startsWith('other_item_'))).toBe(false);
  });

  it('offers every document type once, including every Other type', () => {
    const documents = evidenceDocumentGroups().flatMap((group) => group.choices);
    expect(documents.map((document) => document.key).sort()).toEqual(
      CATALOGUE_DOCUMENTS.map((document) => document.key).sort(),
    );
    const keys = new Set(documents.map((document) => document.key));
    expect(keys.has('OTHER')).toBe(true);
    expect(keys.has('OTHER_FINANCIAL_DOCUMENT')).toBe(true);
  });
});
