import { DESTINATIONS, type Destination, type EntryStatus } from '@visastack/core/destinations';
import { describe, expect, it } from 'vitest';
import { ENTRY_ORDER } from '../../../../lib/country-view';
import { primeLocale } from '../../../../lib/i18n-server';
import { GENERIC_DOCUMENT_ICON, STATUS_ICON_BY_WORD } from '../../../../lib/item-icons';
import { renderServer } from '../../../../lib/next-mocks.test-support';
import { CountryCard, ENTRY_EXPLAIN, ENTRY_MARK } from '../country-view';

const base = DESTINATIONS.find((d) => d.researched && d.source !== null) as Destination;

function card(entryStatus: EntryStatus, over: Partial<Destination> = {}) {
  const researched = entryStatus !== 'NOT_FOUND';
  return renderServer(CountryCard({ destination: { ...base, entryStatus, researched, ...over } }));
}

describe('the Country Card entry type', () => {
  it('gives every entry state its own picture, and its own plain word', async () => {
    await primeLocale();
    const icons = new Set(ENTRY_ORDER.map((s) => ENTRY_MARK[s].icon));
    expect(icons.size).toBe(ENTRY_ORDER.length);
    const words = new Set<string>();
    for (const status of ENTRY_ORDER) {
      const html = await card(status);
      expect(html).toContain(`data-mark="${ENTRY_MARK[status].icon}"`);
      expect(html).toContain('explain-tip');
      expect(ENTRY_EXPLAIN[status].length).toBeGreaterThan(10);
      words.add(html.match(/country-card-word">([^<]+)</)?.[1] ?? '');
    }
    expect(words.size).toBe(ENTRY_ORDER.length);
  });

  it('borrows no picture that a status or a document already wears', () => {
    const taken = new Set<string>([GENERIC_DOCUMENT_ICON, ...Object.values(STATUS_ICON_BY_WORD)]);
    for (const status of ENTRY_ORDER)
      expect(taken.has(ENTRY_MARK[status].icon), status).toBe(false);
  });

  it('never lets an unresearched country look or read like No Visa Needed', async () => {
    await primeLocale();
    const unknown = await card('NOT_FOUND');
    expect(unknown).not.toContain('No Visa Needed');
    expect(unknown).toContain('Not Yet Researched');
    expect(ENTRY_MARK.NOT_FOUND.icon).not.toBe(ENTRY_MARK.VISA_FREE.icon);
    expect(ENTRY_MARK.NOT_FOUND.tone).not.toBe(ENTRY_MARK.VISA_FREE.tone);
    expect(ENTRY_EXPLAIN.NOT_FOUND).toContain('does not mean no visa is needed');
    const free = await card('VISA_FREE');
    expect(free).toContain('No Visa Needed');
    expect(free).not.toContain('Not Yet Researched');
  });

  it('shows the source and the check date, or says the source is not recorded', async () => {
    await primeLocale();
    const withSource = await card('VISA_REQUIRED');
    expect(withSource).toContain('Source:');
    expect(withSource).toMatch(/Checked on|Check date not given/);
    const without = await card('VISA_REQUIRED', { source: null });
    expect(without).toContain('Source Not Recorded');
    expect(without).not.toContain('Source:');
  });
});
