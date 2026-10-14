import { describe, expect, it } from 'vitest';
import { computeCompletion } from './completion';
import { CATALOGUE_MODULES } from './modules';
import { MODULE_FIELDS } from './queries';

const counted = (module: string) => MODULE_FIELDS.filter((f) => f.module === module && !f.role);
const fill = (keys: readonly string[]): Record<string, readonly string[]> =>
  Object.fromEntries(keys.map((k) => [k, ['x']]));
const defaultKeys = CATALOGUE_MODULES.filter((m) => m.defaultOpen).flatMap((m) =>
  counted(m.key).map((f) => f.key),
);

describe('completion', () => {
  it('measures a person who opened nothing against the default sections only', () => {
    const r = computeCompletion({ activated: new Set(), values: {} });
    expect(r.total).toBe(defaultKeys.length);
    expect(r.answered).toBe(0);
    expect(r.percent).toBe(0);
    expect(r.modules.filter((m) => m.open).every((m) => m.reason === 'default')).toBe(true);
  });

  it('reaches 100% when every default field is answered', () => {
    const r = computeCompletion({ activated: new Set(), values: fill(defaultKeys) });
    expect(r.percent).toBe(100);
    expect(r.answered).toBe(r.total);
  });

  it('adds a section to the calculation the moment it is opened', () => {
    const complete = fill(defaultKeys);
    const before = computeCompletion({ activated: new Set(), values: complete });
    const open = computeCompletion({ activated: new Set(['bangladesh_tax']), values: complete });
    const added = counted('bangladesh_tax').length;
    expect(open.total).toBe(before.total + added);
    expect(open.answered).toBe(before.answered);
    expect(open.percent).toBe(Math.round((100 * before.total) / (before.total + added)));
    // Answering the new fields brings it back to 100%.
    const full = computeCompletion({
      activated: new Set(['bangladesh_tax']),
      values: { ...complete, ...fill(counted('bangladesh_tax').map((f) => f.key)) },
    });
    expect(full.percent).toBe(100);
  });

  it('counts nothing for a locked section', () => {
    const r = computeCompletion({ activated: new Set(), values: {} });
    const locked = r.modules.find((m) => m.key === 'bangladesh_tax');
    expect(locked).toMatchObject({ open: false, reason: 'locked', total: 0 });
  });

  it('opens a section that already holds a saved value, so nothing is hidden', () => {
    const r = computeCompletion({ activated: new Set(), values: { dependant_name: ['Rahim'] } });
    expect(r.modules.find((m) => m.key === 'dependants')).toMatchObject({
      open: true,
      reason: 'has_data',
      answered: 1,
    });
    expect(r.total).toBe(defaultKeys.length + counted('dependants').length);
  });

  it('opens the section an Other Item names', () => {
    const r = computeCompletion({
      activated: new Set(),
      values: { other_item_universal_section: ['dependants'], other_item_universal_title: ['x'] },
    });
    expect(r.modules.find((m) => m.key === 'dependants')?.open).toBe(true);
    // The Other Item itself is optional and adds nothing to the total.
    expect(r.total).toBe(defaultKeys.length + counted('dependants').length);
  });

  it('never counts Other text boxes or Other Items', () => {
    const r = computeCompletion({ activated: new Set(), values: {} });
    const defaultModules = new Set(
      CATALOGUE_MODULES.filter((m) => m.defaultOpen).map((m) => m.key),
    );
    // Text boxes beside Other choices in open sections, and Other Items that name no section.
    const roleKeys = MODULE_FIELDS.filter(
      (f) =>
        f.role &&
        (defaultModules.has(f.module) || f.module === 'other_items') &&
        !f.key.endsWith('_section'),
    ).map((f) => f.key);
    expect(roleKeys.length).toBeGreaterThan(0);
    const withRoles = computeCompletion({ activated: new Set(), values: fill(roleKeys) });
    expect(withRoles.total).toBe(r.total);
    expect(withRoles.answered).toBe(0);
  });

  it('does not accept Other until the words that go with it are written', () => {
    const base = fill(defaultKeys);
    const withOther = { ...base, marital_status: ['Other'] };
    expect(computeCompletion({ activated: new Set(), values: withOther }).percent).toBeLessThan(
      100,
    );
    const described = { ...withOther, marital_status_other: ['Customary union'] };
    expect(computeCompletion({ activated: new Set(), values: described }).percent).toBe(100);
  });

  it('treats a field marked "does not apply" and a record marked "none" as answered', () => {
    const r = computeCompletion({
      activated: new Set(),
      values: {},
      notApplicable: new Set(['name_alternate']),
      noneDeclared: new Set(['visa_refusal']),
    });
    const refusals = counted('refusals').length;
    expect(r.answered).toBe(1 + refusals);
  });

  it('keeps extra detail for an open section separate', () => {
    const base = computeCompletion({ activated: new Set(), values: {} });
    const more = computeCompletion({ activated: new Set(['address_details']), values: {} });
    expect(more.total).toBe(base.total + counted('address_details').length);
    expect(more.modules.find((m) => m.key === 'addresses')?.total).toBe(
      base.modules.find((m) => m.key === 'addresses')?.total,
    );
  });

  it('stays between 0 and 100 and ignores sections that are not in the catalogue', () => {
    const r = computeCompletion({ activated: new Set(['no_such_section']), values: {} });
    expect(r.percent).toBeGreaterThanOrEqual(0);
    expect(r.percent).toBeLessThanOrEqual(100);
    expect(r.total).toBe(defaultKeys.length);
  });
});
