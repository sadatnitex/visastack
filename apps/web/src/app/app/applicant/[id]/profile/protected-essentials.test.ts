import { describe, expect, it } from 'vitest';
import { type ProfileEntryLite, buildMasterProfileView } from '../../../../../lib/master-profile';

/**
 * WALD2: the Essentials chip and the field's own badge agree for a protected detail. A protected
 * value counts as Added only when a value really exists: opened with the key, or saved but not
 * opened here (the profile page then hands the editor an empty box marked Saved and Protected, with
 * the same status badge). A detail with no saved version is not Added. Synthetic values only.
 */

function essential(entries: readonly ProfileEntryLite[], key: string) {
  const view = buildMasterProfileView({
    entries,
    activated: new Set(),
    notApplicable: new Set(),
    noneDeclared: new Set(),
    suggestFor: null,
  });
  const item = view.essentials.items.find((candidate) => candidate.key === key);
  if (!item) throw new Error(`${key} is not an essential`);
  return item;
}

describe('protected essentials and their badge agree', () => {
  it.each([
    ['opened with the key', '1990-04-12'],
    ['saved but not opened here', '[protected]'],
    ['saved but could not be opened', '[protected: could not decrypt]'],
  ])('Date of Birth %s counts as Added', (_label, value) => {
    expect(
      essential(
        [{ fieldKey: 'date_of_birth', value, status: 'APPLICANT_CONFIRMED' }],
        'date_of_birth',
      ).answered,
    ).toBe(true);
  });

  it('a protected detail with no saved version is not Added', () => {
    expect(
      essential([{ fieldKey: 'passport_number', value: null, status: null }], 'passport_number')
        .answered,
    ).toBe(false);
    expect(essential([], 'passport_number').answered).toBe(false);
  });
});
