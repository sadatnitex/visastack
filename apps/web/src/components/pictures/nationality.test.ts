import { describe, expect, it } from 'vitest';
import { foldNationality, isBangladeshNationality, passportCoverFor } from './nationality';

/** Bangla words built from code points, so the source stays plain ASCII. */
const BANGLADESH_BN = 'বাংলাদেশ';

describe('isBangladeshNationality', () => {
  it.each([
    'BD',
    'bd',
    ' Bd ',
    'BGD',
    'bgd',
    'Bangladesh',
    'BANGLADESH',
    '  bangladesh\t',
    'Bangladeshi',
    'bangladeshi',
    "People's Republic of Bangladesh",
    'People’s Republic of Bangladesh',
    'B.D.',
    BANGLADESH_BN,
    `${BANGLADESH_BN}ি`,
    `${BANGLADESH_BN}ী`,
    // Some Bangla keyboards put invisible joiners between letters.
    `${BANGLADESH_BN.slice(0, 3)}\u200c${BANGLADESH_BN.slice(3)}\u200d`,
    'Bangla\u200bdeshi',
  ])('reads %j as Bangladesh', (value) => {
    expect(isBangladeshNationality(value)).toBe(true);
    expect(passportCoverFor(value)).toBe('bangladesh');
  });

  it.each([
    null,
    undefined,
    '',
    '   ',
    'Indian',
    'IN',
    'IND',
    'British',
    'Bangladeshi-American dual',
    'Not Bangladesh',
    'BDX',
    'B',
    'Pakistani',
    'Bengali',
  ])('reads %j as not Bangladesh', (value) => {
    expect(isBangladeshNationality(value)).toBe(false);
    expect(passportCoverFor(value)).toBe('neutral');
  });

  it('ignores a value that is not text', () => {
    expect(isBangladeshNationality(42 as unknown as string)).toBe(false);
    expect(isBangladeshNationality({} as unknown as string)).toBe(false);
  });

  it('folds case, spaces and punctuation but keeps letters', () => {
    expect(foldNationality(" People's  Republic-of.Bangladesh ")).toBe(
      'peoplesrepublicofbangladesh',
    );
  });
});
