import { DESTINATIONS, destinationByIso2 } from '@visastack/core/destinations';
import { describe, expect, it } from 'vitest';
import {
  ENTRY_LABEL,
  ENTRY_ORDER,
  checkedOnLabel,
  countryListItem,
  countryListItems,
  isEntryStatus,
  moneyLabel,
  stayLabel,
  trustNotes,
} from './country-view';

const source = (over: Partial<NonNullable<ReturnType<typeof sourceOf>>> = {}) => ({
  ...sourceOf(),
  ...over,
});
function sourceOf() {
  return {
    url: 'https://example.gov/visa',
    title: 'Visa page',
    publisher: 'Example Home Office',
    type: 'government' as string | null,
    language: 'English',
    checkedOn: '2026-10-14' as string | null,
    exactWords: null,
    translation: null,
    where: null,
    confidence: 'HIGH' as string | null,
    needsCheck: false,
    note: null,
  };
}

describe('plain words for the entry rules', () => {
  it('names every status, and never says "no visa needed" for one not yet researched', () => {
    for (const status of ENTRY_ORDER) expect(ENTRY_LABEL[status].length).toBeGreaterThan(3);
    expect(ENTRY_LABEL.NOT_FOUND).toBe('Not yet researched');
    expect(ENTRY_LABEL.NOT_FOUND.toLowerCase()).not.toContain('no visa');
  });

  it('recognises only real statuses', () => {
    expect(isEntryStatus('E_VISA')).toBe(true);
    expect(isEntryStatus('SOMETHING')).toBe(false);
  });
});

describe('warnings beside a fact', () => {
  it('says nothing about an official, confident, checked fact', () => {
    expect(trustNotes(source())).toEqual([]);
  });

  it('warns when the page is not official and when a person should check it', () => {
    expect(trustNotes(source({ type: 'other' }))).toEqual(['Not from an official page.']);
    expect(trustNotes(source({ needsCheck: true }))).toEqual([
      'Needs checking before you rely on it.',
    ]);
    expect(trustNotes(source({ type: 'other', confidence: 'LOW' }))).toHaveLength(2);
  });

  it('says plainly when there is no source at all', () => {
    expect(trustNotes(null)).toEqual(['No source is given for this.']);
  });

  it('shows the check date, or says it is missing', () => {
    expect(checkedOnLabel(source())).toBe('Checked on 14 Oct 2026');
    expect(checkedOnLabel(source({ checkedOn: null }))).toBe('Check date not given');
    expect(checkedOnLabel(null)).toBe('Check date not given');
  });
});

describe('amounts and stays', () => {
  it('shows an amount with its currency and a stay in days, or nothing', () => {
    expect(moneyLabel({ amount: 22450, currency: 'BDT' })).toBe('BDT 22,450');
    expect(moneyLabel(null)).toBeNull();
    expect(stayLabel(90)).toBe('Up to 90 days');
    expect(stayLabel(null)).toBeNull();
  });
});

describe('the country list', () => {
  it('has every country, sorted by name, with only small fields', () => {
    const items = countryListItems();
    expect(items).toHaveLength(DESTINATIONS.length);
    expect(items.map((i) => i.name)).toEqual(
      [...items.map((i) => i.name)].sort((a, b) => a.localeCompare(b)),
    );
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(
      ['fee', 'iso2', 'name', 'stay', 'status', 'unconfirmed'].sort(),
    );
    expect(JSON.stringify(items).length).toBeLessThan(60_000);
  });

  it('marks a country flagged for checking as unconfirmed, and one with nothing known as not yet researched', () => {
    const flagged = destinationByIso2('AZ');
    const kuwait = destinationByIso2('KW');
    if (!flagged || !kuwait) throw new Error('fixture');
    expect(countryListItem(flagged).unconfirmed).toBe(true);
    expect(countryListItem(kuwait).status).toBe('NOT_FOUND');
    expect(countryListItem(kuwait).unconfirmed).toBe(false);
  });
});
