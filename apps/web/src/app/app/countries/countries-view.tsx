import { CountryBrowser } from '../../../components/country-browser';
import { PageHeader } from '../../../components/ui';
import {
  ENTRY_LABEL,
  ENTRY_ORDER,
  ENTRY_SHORT_LABEL,
  countryListItems,
} from '../../../lib/country-view';

/** The country list. `basePath` is where a country's own page lives (the traveller space or an agency's). */
export function CountriesView({ basePath }: { readonly basePath: string }) {
  const items = countryListItems();
  const researched = items.filter((item) => item.status !== 'NOT_FOUND').length;
  const filters = ENTRY_ORDER.map((status) => ({
    status,
    label: ENTRY_SHORT_LABEL[status],
    statusLabel: ENTRY_LABEL[status],
  }));
  return (
    <>
      <PageHeader
        eyebrow="Countries"
        title="Visa rules for a Bangladeshi passport"
        description="What an ordinary Bangladeshi passport needs to enter each country. Every fact shows where it came from and when it was checked."
      />
      <p className="notice">
        {researched} of {items.length} countries have their rules filled in. The rest are marked
        "Not yet researched", which does not mean no visa is needed. Rules change, so always confirm
        on the official page before you apply. This is guidance, not legal advice, and the
        destination decides your application.
      </p>
      <CountryBrowser items={items} filters={filters} basePath={basePath} />
    </>
  );
}
