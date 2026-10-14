import {
  CATALOGUE_MODULES,
  isKnownFieldKey,
  isKnownRecordGroupKey,
} from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import {
  type MasterProfileInput,
  buildMasterProfileView,
  completionOf,
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
