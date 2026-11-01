import { CountriesView } from '../../src/app/app/countries/countries-view';
import { countryListItems } from '../../src/lib/country-view';

/**
 * WP-SB8 scroll budget fixture: the real country list (every country in the catalogue, 156 today)
 * as the traveller and agency pages show it. The pages themselves only add the workspace frame,
 * so this is the list exactly as it renders there.
 *
 * Views:
 * - `traveller` and `agency`: the shared list with the address each workspace gives its rows.
 * - `uncapped`: every country listed at once with the same classes, as before WP-SB8, which proves
 *   the budget check fails on it.
 */
export interface Sb8FixtureProps {
  readonly view: 'traveller' | 'agency' | 'uncapped';
}

export default function Sb8Fixture({ view }: Sb8FixtureProps) {
  if (view === 'uncapped') {
    return (
      <div className="container">
        <ul className="country-list">
          {countryListItems().map((item) => (
            <li key={item.iso2}>
              <a className="country-row" href={`/app/countries/${item.iso2.toLowerCase()}`}>
                <span className="country-row-name">{item.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  return (
    <div className="container">
      <CountriesView
        href={view === 'agency' ? '/app/agency/org-1/countries/[code]' : '/app/countries/[code]'}
      />
    </div>
  );
}
