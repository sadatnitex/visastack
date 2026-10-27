import { CATALOGUE_MODULES, MODULE_FIELDS } from '@visastack/core/catalogue';
import { describe, expect, it } from 'vitest';
import {
  type MasterProfileInput,
  buildMasterProfileView,
  essentialsProgress,
} from './master-profile';
import { PROFILE_ESSENTIALS } from './profile-essentials';
import { PROFILE_FIELDS } from './profile-fields';

const none = (overrides: Partial<MasterProfileInput> = {}): MasterProfileInput => ({
  entries: [],
  activated: new Set(),
  notApplicable: new Set(),
  noneDeclared: new Set(),
  suggestFor: null,
  ...overrides,
});
const entry = (fieldKey: string, value: string | null = 'Synthetic') => ({
  fieldKey,
  value,
  status: 'DECLARED',
});
const OPEN_FOR_EVERYONE = new Set(
  CATALOGUE_MODULES.filter((module) => module.defaultOpen).map((module) => module.key),
);
const LIVE = new Map(PROFILE_FIELDS.map((field) => [field.key, field] as const));

describe('the Essentials First list (one list, in one place)', () => {
  it('is short: about eight to twelve details, none twice', () => {
    expect(PROFILE_ESSENTIALS.length).toBeGreaterThanOrEqual(8);
    expect(PROFILE_ESSENTIALS.length).toBeLessThanOrEqual(12);
    const keys = PROFILE_ESSENTIALS.map((essential) => essential.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('names only live details that sit in a section open for everyone, so each can always be filled in', () => {
    for (const essential of PROFILE_ESSENTIALS) {
      const fields = MODULE_FIELDS.filter((field) =>
        essential.kind === 'field' ? field.key === essential.key : field.group === essential.key,
      );
      expect(fields.length, essential.key).toBeGreaterThan(0);
      const home = fields[0];
      expect(OPEN_FOR_EVERYONE.has(home?.module ?? ''), essential.key).toBe(true);
      if (essential.kind === 'field') {
        // A single live detail, never a role field (Other text, tax basis) or part of a record.
        expect(LIVE.get(essential.key)?.group, essential.key).toBeUndefined();
        expect(LIVE.has(essential.key), essential.key).toBe(true);
        expect(home?.role, essential.key).toBeUndefined();
      } else {
        expect(
          PROFILE_FIELDS.some((field) => field.group === essential.key),
          essential.key,
        ).toBe(true);
      }
    }
  });

  it('starts with name, birth, nationality and passport, and keeps contact and the home address', () => {
    const keys = PROFILE_ESSENTIALS.map((essential) => essential.key);
    for (const key of [
      'given_name',
      'family_name',
      'date_of_birth',
      'nationality',
      'passport_number',
      'passport_expiry',
      'email',
      'phone',
      'address',
    ])
      expect(keys).toContain(key);
  });
});

describe('essentials in the profile view', () => {
  it('lists every essential, in order, with its section, and none answered for a new person', () => {
    const { essentials } = buildMasterProfileView(none());
    expect(essentials.items.map((item) => item.key)).toEqual(
      PROFILE_ESSENTIALS.map((essential) => essential.key),
    );
    expect(essentials.total).toBe(PROFILE_ESSENTIALS.length);
    expect(essentials.answered).toBe(0);
    const passport = essentials.items.find((item) => item.key === 'passport_number');
    expect(passport?.sectionKey).toBe('passport');
    expect(passport?.field?.label).toBe('Passport Number');
    const address = essentials.items.find((item) => item.key === 'address');
    expect(address?.label).toBe('Home Address');
    expect(address?.sectionKey).toBe('addresses');
    // The same record the Addresses section shows, not the extra details a locked section adds.
    expect(address?.group?.fields.map((field) => field.key)).toEqual(
      PROFILE_FIELDS.filter((field) => field.group === 'address').map((field) => field.key),
    );
  });

  it('counts an essential exactly as completion does: a value, "does not apply", or "none" for the address', () => {
    const view = buildMasterProfileView(
      none({
        entries: [entry('given_name'), entry('family_name', '   ')],
        notApplicable: new Set(['passport_number']),
        noneDeclared: new Set(['address']),
      }),
    );
    const answered = view.essentials.items.filter((item) => item.answered).map((item) => item.key);
    // A blank value is not an answer.
    expect(answered).toEqual(['given_name', 'passport_number', 'address']);
    expect(view.essentials.answered).toBe(3);
    expect(
      view.essentials.items.find((item) => item.key === 'passport_number')?.notApplicable,
    ).toBe(true);
    expect(view.essentials.items.find((item) => item.key === 'address')?.group?.noneDeclared).toBe(
      true,
    );
  });

  it('counts the home address once its main detail is saved in any record, and a protected value as saved', () => {
    const view = buildMasterProfileView(
      none({ entries: [entry('address_line'), entry('passport_number', null)] }),
    );
    const answered = view.essentials.items.filter((item) => item.answered).map((item) => item.key);
    expect(answered).toEqual(['passport_number', 'address']);
  });

  it('gives the overview the same number as the profile screen', () => {
    const input = none({
      entries: [entry('given_name'), entry('email')],
      notApplicable: new Set(['phone']),
    });
    const view = buildMasterProfileView(input);
    expect(essentialsProgress(input.entries, input)).toEqual({
      answered: view.essentials.answered,
      total: view.essentials.total,
    });
    expect(view.essentials.answered).toBe(3);
  });
});
