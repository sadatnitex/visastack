import { getPublicTrustRoute, safeHttpUrl } from '@visastack/services';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { TrustUnavailable } from '../../../components/trust-unavailable';
import { PageHeader } from '../../../components/ui';
import { trustCatalog } from '../../../i18n/trust';
import { formatDateOnly } from '../../../lib/format-date';
import { getServerT, primeLocale } from '../../../lib/i18n-server';
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
  await primeLocale();
  const t = getServerT(trustCatalog);
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
        eyebrow={t('trust.trustPackkeyPage.publicTrustVVersion', { version: route.version })}
        title={route.packName}
        description={[route.jurisdiction, route.route, route.purpose].filter(Boolean).join(' · ')}
      />

      <div className="notice" style={{ marginBottom: '2rem' }}>
        {t('trust.trustPackkeyPage.thisPageDescribesTheOfficialProcess')}
      </div>

      <div className="grid">
        <article className="card">
          <p className="card-kicker">{t('trust.trustPackkeyPage.route')}</p>
          <h2 className="card-title">{t('trust.trustPackkeyPage.whatThisRouteIs')}</h2>
          <p className="card-body">{route.routeDescription}</p>
          {route.effectiveDate ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.75rem' }}>
              {t('trust.trustPackkeyPage.inEffectSinceFormatdateonly', {
                formatDateOnly: formatDateOnly(route.effectiveDate),
              })}
            </p>
          ) : null}
          {route.nextReviewDate ? (
            <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.25rem' }}>
              {t('trust.trustPackkeyPage.nextReviewedFormatdateonly', {
                formatDateOnly: formatDateOnly(route.nextReviewDate),
              })}
            </p>
          ) : null}
        </article>

        <article className="card">
          <p className="card-kicker">{t('trust.trustPackkeyPage.officialFee')}</p>
          <h2 className="card-title">{t('trust.trustPackkeyPage.whatTheGovernmentCharges')}</h2>
          {route.officialFee ? (
            <>
              <p className="card-body" style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                {formatPrice(route.officialFee.minorUnits, route.officialFee.currency)}
              </p>
              <p className="muted u-fs-085">
                {t('trust.trustPackkeyPage.theOfficialGovernmentFeeOnlyAny')}
              </p>
            </>
          ) : (
            <>
              <span className="badge badge-warning">
                {t('trust.trustPackkeyPage.notCurrentlyVerified')}
              </span>
              <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.5rem' }}>
                {t('trust.trustPackkeyPage.weDoNotShowAFee')}
              </p>
            </>
          )}
        </article>

        <article className="card">
          <p className="card-kicker">{t('trust.trustPackkeyPage.officialChannel')}</p>
          <h2 className="card-title">{t('trust.trustPackkeyPage.whereToActuallyApply')}</h2>
          {officialChannelUrl ? (
            <a
              className="btn btn-primary"
              href={officialChannelUrl}
              target="_blank"
              rel="noreferrer"
            >
              {route.officialChannelName ?? t('trust.trustPackkeyPage.officialApplicationChannel')}{' '}
              ↗
            </a>
          ) : (
            <p className="card-body">{t('trust.trustPackkeyPage.notYetOnFileForThis')}</p>
          )}
          <p className="muted" style={{ fontSize: 'var(--text-small)', marginTop: '0.75rem' }}>
            {t('trust.trustPackkeyPage.theOnlyChannelThatActuallyDecides')}
          </p>
        </article>

        <article className="card">
          <p className="card-kicker">{t('trust.trustPackkeyPage.officialSource')}</p>
          <h2 className="card-title">
            {t('trust.trustPackkeyPage.whereThisInformationComesFrom')}
          </h2>
          {officialSources.length === 0 ? (
            <p className="card-body">{t('trust.trustPackkeyPage.notYetOnFileForThis')}</p>
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
                      t('trust.trustPackkeyPage.officialSource')}
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
        <p className="card-kicker">{t('trust.trustPackkeyPage.scamAwareness')}</p>
        <h2 className="card-title">{t('trust.trustPackkeyPage.warningSignsToWatchFor')}</h2>
        <p className="muted" style={{ margin: '0.35rem 0 1rem', fontSize: 'var(--text-small)' }}>
          {t('trust.trustPackkeyPage.generalGuidanceTheSameForEvery')}
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
