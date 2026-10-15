import { describe, expect, it } from 'vitest';
import { renderServer, textOf } from '../../../../../lib/next-mocks.test-support';
import AgencyCountryPage from './[iso2]/page';
import AgencyCountriesPage from './page';

const list = () =>
  renderServer(AgencyCountriesPage({ params: Promise.resolve({ orgId: 'org-1' }) }));
const detail = (iso2: string) =>
  renderServer(AgencyCountryPage({ params: Promise.resolve({ orgId: 'org-1', iso2 }) }));

describe('country rules inside the agency workspace', () => {
  it('shows the same list, with every country linking to its page in the agency workspace', async () => {
    const html = await list();
    expect(textOf(html)).toContain('Visa rules for a Bangladeshi passport');
    expect(html).toContain('href="/app/agency/org-1/countries/gb"');
    expect(html).not.toContain('href="/app/countries/gb"');
  });

  it('shows a country with the way back staying in the agency workspace', async () => {
    const html = await detail('gb');
    expect(textOf(html)).toContain('United Kingdom');
    expect(html).toContain('href="/app/agency/org-1/countries"');
    expect(html).not.toContain('href="/app/countries"');
  });

  it('says not found for an unknown country code', async () => {
    await expect(detail('zz')).rejects.toThrow('NEXT_NOT_FOUND');
  });
});
