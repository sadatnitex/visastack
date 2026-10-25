import { getPublicTrustRoute, safeHttpUrl } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { TrustUnavailable } from '../../../components/trust-unavailable';
import { PageHeader } from '../../../components/ui';
import { formatDateOnly } from '../../../lib/format-date';
import { withPublicDb } from '../../../lib/public-db';
import { reportServerError } from '../../../lib/server-error';
import { formatPrice } from '../../../lib/usage-format';

export const dynamic = 'force-dynamic';

/** One lookup per request, shared by the page and its title. */
const loadRoute = cache(async (packKey: string) => {
  try {
    return {
      unavailable: false as const,
      route: await withPublicDb((db) => getPublicTrustRoute(db, packKey)),
    };
  } catch (error) {
    reportServerError('trust route', error);
    return { unavailable: true as const, route: null };
  }
});

/** The route's own name is public information, so the tab says which route this is (WCAG 2.4.2). */
export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ packKey: string }>;
}): Promise<Metadata> {
  const { packKey } = await params;
  const { route } = await loadRoute(packKey);
  return { title: route ? route.packName : 'Route Information' };
}

/**
 * ScamShield Lite (directive §9): a general, platform-level checklist and
 * reporting guidance -- never route-authored, never naming a specific
 * agency or party (no fraud accusation without evidence/process), never a
 * fabricated reporting link. A route's own verified `officialReportingUrl`,
 * shown separately above this section when one is on file, is the only
 * place a specific link ever appears.
 */
const SCAM_WARNING_SIGNS: readonly string[] = [
  'A guaranteed approval, or a promise no genuine visa process can make.',
  'A request to pay by personal bank transfer, cryptocurrency, or gift cards instead of the official channel shown above.',
  'Pressure to pay an upfront "processing fee" before any real application has started.',
  'A claim of special access, personal contacts, or a guaranteed fast-track at the embassy or consulate.',
  'Unsolicited contact through WhatsApp, social media, or a messaging app offering visa help.',
  'Being asked to sign a blank form, or to hand over original documents with no receipt.',
  'A website whose address does not match the official channel shown above for this route.',
];

export default async function PublicTrustRoutePage({
  params,
}: {
  readonly params: Promise<{ packKey: string }>;
}) {
  const { packKey } = await params;
  const { route, unavailable } = await loadRoute(packKey);
  if (unavailable) return <TrustUnavailable />;
  if (!route) notFound();

  // Links an author typed in render only if they are absolute http(s) URLs; a
  // stored value that is anything else reads as "not on file".
  const officialChannelUrl = safeHttpUrl(route.officialChannelUrl);
  const officialReportingUrl = safeHttpUrl(route.officialReportingUrl);
  const officialSources = route.officialSources.map((source) => ({
    source,
    href: safeHttpUrl(source.sourceUrl),
  }));

  return (
    <section className="section container">
      <PageHeader
        back={{ href: '/trust', label: 'Public Trust' }}
        eyebrow={`Public Trust · v${route.version}`}
        title={route.packName}
        description={[route.jurisdiction, route.route, route.purpose].filter(Boolean).join(' · ')}
      />

      <div className="notice" style={{ marginBottom: '2rem' }}>
        This page describes the official process only. It is not an embassy or government service,
        does not guarantee approval, and does not endorse any particular agency. Anyone may use this
        route directly, with no agency at all.
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">Route</p>
          <h2 className="card-title">What this route is</h2>
          <p className="card-body">{route.routeDescription}</p>
          {route.effectiveDate ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.75rem' }}>
              In effect since {formatDateOnly(route.effectiveDate)}
            </p>
          ) : null}
          {route.nextReviewDate ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.25rem' }}>
              Next reviewed {formatDateOnly(route.nextReviewDate)}
            </p>
          ) : null}
        </article>

        <article className="card">
          <p className="card-kicker">Official Fee</p>
          <h2 className="card-title">What the Government Charges</h2>
          {route.officialFee ? (
            <>
              <p className="card-body" style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                {formatPrice(route.officialFee.minorUnits, route.officialFee.currency)}
              </p>
              <p className="muted u-fs-085">
                The official government fee only. Any agency you choose to work with charges its own
                service fee separately - never included here.
              </p>
            </>
          ) : (
            <>
              <span className="badge badge-warning">Not currently verified</span>
              <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.5rem' }}>
                We do not show a fee amount here unless it is currently verified. Confirm the exact,
                current fee at the official channel below before paying anyone.
              </p>
            </>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">Official Channel</p>
          <h2 className="card-title">Where to Actually Apply</h2>
          {officialChannelUrl ? (
            <a
              className="btn btn-primary"
              href={officialChannelUrl}
              target="_blank"
              rel="noreferrer"
            >
              {route.officialChannelName ?? 'Official application channel'} ↗
            </a>
          ) : (
            <p className="card-body">Not yet on file for this route.</p>
          )}
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.75rem' }}>
            The only channel that actually decides your case. VisaStack and any agency you work with
            only help you prepare for it.
          </p>
        </article>

        <article className="card">
          <p className="card-kicker">Official Source</p>
          <h2 className="card-title">Where This Information Comes From</h2>
          {officialSources.length === 0 ? (
            <p className="card-body">Not yet on file for this route.</p>
          ) : (
            <div className="rows u-mt-050">
              {officialSources.map(({ source, href }) => (
                <div
                  className="row"
                  key={`${source.publisher ?? ''}|${source.sourceTitle ?? ''}|${source.sourceUrl ?? ''}`}
                  style={{ flexDirection: 'column', alignItems: 'flex-start' }}
                >
                  <span className="row-key">
                    {[source.publisher, source.sourceTitle].filter(Boolean).join(' · ') ||
                      'Official Source'}
                  </span>
                  {href ? (
                    <a href={href} target="_blank" rel="noreferrer" className="u-fs-085">
                      {href}
                    </a>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </article>
      </div>

      <article className="card u-mt-150">
        <p className="card-kicker">Scam Awareness</p>
        <h2 className="card-title">Warning Signs to Watch For</h2>
        <p className="muted" style={{ margin: '0.35rem 0 1rem', fontSize: 'var(--text-small)' }}>
          General guidance, the same for every route - not specific to this one, and never an
          accusation against any named person or agency.
        </p>
        <ul className="pill-list" style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
          {SCAM_WARNING_SIGNS.map((sign) => (
            <li key={sign} className="card-body" style={{ padding: '0.35rem 0' }}>
              {sign}
            </li>
          ))}
        </ul>
        <p className="card-body u-mt-100">
          If you suspect fraud, report it to the official immigration authority for the destination
          country and to your own country's consumer-protection or cybercrime authority.
          {officialReportingUrl ? (
            <>
              {' '}
              For this route specifically:{' '}
              <a href={officialReportingUrl} target="_blank" rel="noreferrer">
                official reporting channel ↗
              </a>
            </>
          ) : null}
        </p>
      </article>
    </section>
  );
}
