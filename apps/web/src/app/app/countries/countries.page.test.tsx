import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../../lib/next-mocks.test-support';
import CountryPage from './[iso2]/page';
import CountriesPage from './page';

const detail = (iso2: string) => renderServer(CountryPage({ params: Promise.resolve({ iso2 }) }));

describe('the country list page', () => {
  it('says how many countries are filled in and that the rest do not mean no visa is needed', async () => {
    const text = textOf(await renderServer(CountriesPage()));
    expect(text).toContain('Visa rules for a Bangladeshi passport');
    expect(text).toMatch(/\d+ of 156 countries have their rules filled in/);
    expect(text).toContain('does not mean no visa is needed');
    expect(text).toContain('not legal advice');
  });
});

describe('a country page', () => {
  it('shows the short version with its source link, check date and warnings', async () => {
    const html = await detail('gb');
    const text = textOf(html);
    expect(text).toContain('United Kingdom');
    expect(text).toContain('Visa needed before you travel');
    expect(text).toContain('Up to 180 days');
    expect(text).toContain('BDT 22,450');
    expect(text).toMatch(/Checked on \d+ \w+ 2026/);
    expect(html).toContain('href="https://www.gov.uk/');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it('shows what to submit, split into documents and steps, and warns when a list is short', async () => {
    const text = textOf(await detail('gb'));
    expect(text).toContain('Documents');
    expect(text).toContain('Valid passport or travel document');
  });

  it('gives every Schengen state the shared Schengen visa type', async () => {
    const text = textOf(await detail('at'));
    expect(text).toContain('Visa types');
    expect(text).toMatch(/Schengen/i);
  });

  it('flags a country whose facts need checking', async () => {
    const text = textOf(await detail('az'));
    expect(text).toContain('Needs checking before you rely on it.');
  });

  it('says a country not yet researched is not yet researched, and never that no visa is needed', async () => {
    const text = textOf(await detail('kw'));
    expect(text).toContain('Not yet researched');
    expect(text).toContain('does not mean no visa is needed');
    expect(text).not.toContain('No visa needed');
  });

  it('is case-insensitive about the code, and not found for an unknown one', async () => {
    expect(textOf(await detail('GB'))).toContain('United Kingdom');
    await expect(detail('zz')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});

describe('the traveller space links', () => {
  it('opens countries and goes back inside the traveller space', async () => {
    const list = await renderServer(CountriesPage());
    expect(list).toContain('href="/app/countries/gb"');
    expect(await detail('gb')).toContain('href="/app/countries"');
  });
});
