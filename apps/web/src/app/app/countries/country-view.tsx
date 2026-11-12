import {
  type Destination,
  type DestinationRequirement,
  type DestinationRoute,
  routesForDestination,
} from '@visastack/core/destinations';
import { CountryFlag } from '../../../components/country-flag';
import { SourceNote } from '../../../components/source-note';
import { EmptyState, PageHeader, StatusBadge } from '../../../components/ui';
import { appCountriesCatalog } from '../../../i18n/app-countries';
import {
  ENTRY_LABEL,
  THIN_LIST,
  isUnofficial,
  moneyLabel,
  needsChecking,
  stayLabel,
} from '../../../lib/country-view';
import { humanizeCode } from '../../../lib/format-code';
import { getServerT } from '../../../lib/i18n-server';

const HOW_TO_APPLY: Readonly<Record<string, string>> = {
  E_VISA_PORTAL: 'Online, on the official e-visa site',
  EMBASSY: 'At the embassy or consulate',
  APPLICATION_CENTRE: 'Through a visa application centre',
  ON_ARRIVAL: 'At the border when you arrive',
  NONE: 'No Application Needed',
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  DOCUMENT: 'Documents',
  DETAIL: 'Details to Give',
  PROCESS_STEP: 'Steps',
};
const KIND_ORDER = ['DOCUMENT', 'DETAIL', 'PROCESS_STEP'] as const;

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="country-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Requirement({ item }: { readonly item: DestinationRequirement }) {
  const t = getServerT(appCountriesCatalog);
  const warn = needsChecking(item.source) || isUnofficial(item.source);
  return (
    <li>
      <span>{item.text}</span>
      {item.optional ? (
        <span className="muted"> {t('appCountries.appCountriesCountryView.optional')}</span>
      ) : null}
      {item.onlyWhen ? (
        <span className="muted">
          {' '}
          {t('appCountries.appCountriesCountryView.onlyWhenOnlywhen', { onlyWhen: item.onlyWhen })}
        </span>
      ) : null}
      {item.maxAgeDays !== null ? (
        <span className="muted">
          {' '}
          {t('appCountries.appCountriesCountryView.mustBeDatedWithinMaxagedaysDays', {
            maxAgeDays: item.maxAgeDays,
          })}
        </span>
      ) : null}
      {warn ? (
        <span className="badge badge-warning">
          {t('appCountries.appCountriesCountryView.needsChecking')}
        </span>
      ) : null}
    </li>
  );
}

function RouteCard({ route }: { readonly route: DestinationRoute }) {
  const t = getServerT(appCountriesCatalog);
  const fee = moneyLabel(route.fee);
  return (
    <article className="card country-route">
      <p className="card-kicker">{humanizeCode(route.purpose)}</p>
      <h3 className="card-title">{route.name}</h3>
      {route.description ? <p className="card-body">{route.description}</p> : null}
      <dl className="country-facts">
        {fee ? <Fact label={t('appCountries.appCountriesCountryView.fee')}>{fee}</Fact> : null}
        {route.channelUrl ? (
          <Fact label={t('appCountries.appCountriesCountryView.whereToApply')}>
            <a href={route.channelUrl} target="_blank" rel="noopener noreferrer">
              {route.channelName ?? route.channelUrl}
            </a>
          </Fact>
        ) : null}
        {route.rulesTakeEffectOn ? (
          <Fact label={t('appCountries.appCountriesCountryView.rulesTakeEffect')}>
            {route.rulesTakeEffectOn}
          </Fact>
        ) : null}
        {route.fraudReportingUrl ? (
          <Fact label={t('appCountries.appCountriesCountryView.reportAScam')}>
            <a href={route.fraudReportingUrl} target="_blank" rel="noopener noreferrer">
              {t('appCountries.appCountriesCountryView.officialReportingPage')}
            </a>
          </Fact>
        ) : null}
      </dl>
      <SourceNote source={route.source} />
      {route.requirements.length === 0 ? (
        <p className="muted">{t('appCountries.appCountriesCountryView.noListOfWhatToSubmit')}</p>
      ) : (
        <>
          {KIND_ORDER.map((kind) => {
            const items = route.requirements.filter((r) => r.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="country-requirements">
                <h4>{KIND_LABEL[kind]}</h4>
                <ul>
                  {items.map((item) => (
                    <Requirement key={`${item.kind}-${item.text}`} item={item} />
                  ))}
                </ul>
              </div>
            );
          })}
          {route.requirements.length < THIN_LIST ? (
            <p className="muted">
              {t('appCountries.appCountriesCountryView.thisListMayNotBeComplete')}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

function Facts({ destination }: { readonly destination: Destination }) {
  const t = getServerT(appCountriesCatalog);
  const fee = moneyLabel(destination.fee);
  const stay = stayLabel(destination.maximumStayDays);
  return (
    <article className="card">
      <p className="card-kicker">{t('appCountries.appCountriesCountryView.theShortVersion')}</p>
      <h2 className="card-title">{ENTRY_LABEL[destination.entryStatus]}</h2>
      <dl className="country-facts">
        {stay || destination.stayPeriodRule ? (
          <Fact label={t('appCountries.appCountriesCountryView.howLongYouCanStay')}>
            {[stay, destination.stayPeriodRule].filter(Boolean).join(' - ')}
          </Fact>
        ) : null}
        {destination.passportValidityRule ? (
          <Fact label={t('appCountries.appCountriesCountryView.passport')}>
            {destination.passportValidityRule}
          </Fact>
        ) : null}
        {destination.howToApply ? (
          <Fact label={t('appCountries.appCountriesCountryView.howToApply')}>
            {HOW_TO_APPLY[destination.howToApply] ?? humanizeCode(destination.howToApply)}
            {destination.applyUrl ? (
              <>
                {' '}
                <a href={destination.applyUrl} target="_blank" rel="noopener noreferrer">
                  {t('appCountries.appCountriesCountryView.officialPage')}
                </a>
              </>
            ) : null}
          </Fact>
        ) : null}
        {destination.bangladeshLocation ? (
          <Fact label={t('appCountries.appCountriesCountryView.whereToSubmitInBangladesh')}>
            {destination.bangladeshLocation}
          </Fact>
        ) : null}
        {fee ? <Fact label={t('appCountries.appCountriesCountryView.fee')}>{fee}</Fact> : null}
      </dl>
      <SourceNote source={destination.source} />
    </article>
  );
}

/** One country's page. `backHref` is the list it came from, so the way back stays in the same workspace. */
export function CountryView({
  destination,
  backHref,
}: {
  readonly destination: Destination;
  readonly backHref: string;
}) {
  const t = getServerT(appCountriesCatalog);
  const routes = routesForDestination(destination);

  return (
    <>
      <PageHeader
        back={{ href: backHref, label: 'All Countries' }}
        eyebrow={t('appCountries.appCountriesCountryView.country')}
        lead={<CountryFlag iso2={destination.iso2} name={destination.country} size="lg" />}
        title={destination.country}
        description={t(
          'appCountries.appCountriesCountryView.forAnOrdinaryBangladeshiPassportRules',
        )}
        meta={
          <StatusBadge tone={destination.researched ? 'neutral' : 'warning'}>
            {ENTRY_LABEL[destination.entryStatus]}
          </StatusBadge>
        }
      />
      {destination.researched ? (
        <Facts destination={destination} />
      ) : (
        <EmptyState
          icon="search"
          title={t('appCountries.appCountriesCountryView.notYetResearched')}
        >
          We have not collected the rules for {destination.country} yet. That does not mean no visa
          is needed.
          {destination.source ? (
            <>
              {' '}
              Start with the{' '}
              <a href={destination.source.url} target="_blank" rel="noopener noreferrer">
                official page
              </a>
              .
            </>
          ) : null}
        </EmptyState>
      )}
      <h2 className="country-routes-heading">
        {t('appCountries.appCountriesCountryView.visaTypes')}
      </h2>
      {routes.length === 0 ? (
        <p className="muted">
          {t('appCountries.appCountriesCountryView.theVisaTypesForCountryHave', {
            country: destination.country,
          })}
        </p>
      ) : (
        <div className="country-routes">
          {routes.map((route) => (
            <RouteCard key={route.key} route={route} />
          ))}
        </div>
      )}
    </>
  );
}
