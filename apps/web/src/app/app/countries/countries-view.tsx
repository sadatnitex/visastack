import { CountryBrowser } from '../../../components/country-browser';
import { PageHeader } from '../../../components/ui';
import { appCountriesCatalog } from '../../../i18n/app-countries';
import {
  ENTRY_LABEL,
  ENTRY_ORDER,
  ENTRY_SHORT_LABEL,
  countryListItems,
} from '../../../lib/country-view';
import { getServerT } from '../../../lib/i18n-server';

/**
 * The country list. `href` is the address of a country's own page in the workspace this list is shown in,
 * written like the route itself with `[code]` where the country's two-letter code goes.
 */
export function CountriesView({ href }: { readonly href: string }) {
  const t = getServerT(appCountriesCatalog);
  const items = countryListItems().map((item) => ({
    ...item,
    href: href.replace('[code]', item.iso2.toLowerCase()),
  }));
  const researched = items.filter((item) => item.status !== 'NOT_FOUND').length;
  const filters = ENTRY_ORDER.map((status) => ({
    status,
    label: ENTRY_SHORT_LABEL[status],
    statusLabel: ENTRY_LABEL[status],
  }));
  return (
    <>
      <PageHeader
        eyebrow={t('appCountries.appCountriesCountriesView.countries')}
        title={t('appCountries.appCountriesCountriesView.visaRulesForABangladeshiPassport')}
        description={t(
          'appCountries.appCountriesCountriesView.whatAnOrdinaryBangladeshiPassportNeeds',
        )}
      />
      <p className="notice">
        {t('appCountries.appCountriesCountriesView.researchedOfLengthCountriesHaveTheir', {
          researched,
          length: items.length,
        })}
      </p>
      <CountryBrowser items={items} filters={filters} />
    </>
  );
}
