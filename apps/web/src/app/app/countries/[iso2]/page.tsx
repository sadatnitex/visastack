import {
  type Destination,
  type DestinationRequirement,
  type DestinationRoute,
  destinationByIso2,
  routesForDestination,
} from '@visastack/core/destinations';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { SourceNote } from '../../../../components/source-note';
import { EmptyState, PageHeader, StatusBadge } from '../../../../components/ui';
import {
  ENTRY_LABEL,
  isUnofficial,
  moneyLabel,
  needsChecking,
  stayLabel,
} from '../../../../lib/country-view';
import { humanizeCode } from '../../../../lib/format-code';

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ iso2: string }>;
}): Promise<Metadata> {
  const { iso2 } = await params;
  const destination = destinationByIso2(iso2);
  return { title: destination ? destination.country : 'Country' };
}

const HOW_TO_APPLY: Readonly<Record<string, string>> = {
  E_VISA_PORTAL: 'Online, on the official e-visa site',
  EMBASSY: 'At the embassy or consulate',
  APPLICATION_CENTRE: 'Through a visa application centre',
  ON_ARRIVAL: 'At the border when you arrive',
  NONE: 'No application needed',
};

const KIND_LABEL: Readonly<Record<string, string>> = {
  DOCUMENT: 'Documents',
  DETAIL: 'Details to give',
  PROCESS_STEP: 'Steps',
};
const KIND_ORDER = ['DOCUMENT', 'DETAIL', 'PROCESS_STEP'] as const;

/** A route's list is not a full checklist unless it is long; say so rather than imply it is complete. */
const THIN_LIST = 5;

function Fact({ label, children }: { readonly label: string; readonly children: React.ReactNode }) {
  return (
    <div className="country-fact">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Requirement({ item }: { readonly item: DestinationRequirement }) {
  const warn = needsChecking(item.source) || isUnofficial(item.source);
  return (
    <li>
      <span>{item.text}</span>
      {item.optional ? <span className="muted"> (optional)</span> : null}
      {item.onlyWhen ? <span className="muted"> Only when: {item.onlyWhen}</span> : null}
      {item.maxAgeDays !== null ? (
        <span className="muted"> Must be dated within {item.maxAgeDays} days.</span>
      ) : null}
      {warn ? <span className="badge badge-warning">Needs checking</span> : null}
    </li>
  );
}

function RouteCard({ route }: { readonly route: DestinationRoute }) {
  const fee = moneyLabel(route.fee);
  return (
    <article className="card country-route">
      <p className="card-kicker">{humanizeCode(route.purpose)}</p>
      <h3 className="card-title">{route.name}</h3>
      {route.description ? <p className="card-body">{route.description}</p> : null}
      <dl className="country-facts">
        {fee ? <Fact label="Fee">{fee}</Fact> : null}
        {route.channelUrl ? (
          <Fact label="Where to apply">
            <a href={route.channelUrl} target="_blank" rel="noopener noreferrer">
              {route.channelName ?? route.channelUrl}
            </a>
          </Fact>
        ) : null}
        {route.rulesTakeEffectOn ? (
          <Fact label="Rules take effect">{route.rulesTakeEffectOn}</Fact>
        ) : null}
        {route.fraudReportingUrl ? (
          <Fact label="Report a scam">
            <a href={route.fraudReportingUrl} target="_blank" rel="noopener noreferrer">
              Official reporting page
            </a>
          </Fact>
        ) : null}
      </dl>
      <SourceNote source={route.source} />
      {route.requirements.length === 0 ? (
        <p className="muted">
          No list of what to submit has been added for this route yet. Check the official page.
        </p>
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
              This list may not be complete. Check the official page for everything you need to
              submit.
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

function Facts({ destination }: { readonly destination: Destination }) {
  const fee = moneyLabel(destination.fee);
  const stay = stayLabel(destination.maximumStayDays);
  return (
    <article className="card">
      <p className="card-kicker">The short version</p>
      <h2 className="card-title">{ENTRY_LABEL[destination.entryStatus]}</h2>
      <dl className="country-facts">
        {stay || destination.stayPeriodRule ? (
          <Fact label="How long you can stay">
            {[stay, destination.stayPeriodRule].filter(Boolean).join(' - ')}
          </Fact>
        ) : null}
        {destination.passportValidityRule ? (
          <Fact label="Passport">{destination.passportValidityRule}</Fact>
        ) : null}
        {destination.howToApply ? (
          <Fact label="How to apply">
            {HOW_TO_APPLY[destination.howToApply] ?? humanizeCode(destination.howToApply)}
            {destination.applyUrl ? (
              <>
                {' '}
                <a href={destination.applyUrl} target="_blank" rel="noopener noreferrer">
                  Official page
                </a>
              </>
            ) : null}
          </Fact>
        ) : null}
        {destination.bangladeshLocation ? (
          <Fact label="Where to submit in Bangladesh">{destination.bangladeshLocation}</Fact>
        ) : null}
        {fee ? <Fact label="Fee">{fee}</Fact> : null}
      </dl>
      <SourceNote source={destination.source} />
    </article>
  );
}

export default async function CountryPage({
  params,
}: {
  readonly params: Promise<{ iso2: string }>;
}) {
  const { iso2 } = await params;
  const destination = destinationByIso2(iso2);
  if (!destination) notFound();
  const routes = routesForDestination(destination);

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/app/countries', label: 'All countries' }}
        eyebrow="Country"
        title={destination.country}
        description="For an ordinary Bangladeshi passport. Rules change, so confirm on the official page before you apply."
        meta={
          <StatusBadge tone={destination.researched ? 'neutral' : 'warning'}>
            {ENTRY_LABEL[destination.entryStatus]}
          </StatusBadge>
        }
      />
      {destination.researched ? (
        <Facts destination={destination} />
      ) : (
        <EmptyState icon="search" title="Not yet researched">
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
      <h2 className="country-routes-heading">Visa types</h2>
      {routes.length === 0 ? (
        <p className="muted">
          The visa types for {destination.country} have not been added yet. Check the official page.
        </p>
      ) : (
        <div className="country-routes">
          {routes.map((route) => (
            <RouteCard key={route.key} route={route} />
          ))}
        </div>
      )}
    </section>
  );
}
