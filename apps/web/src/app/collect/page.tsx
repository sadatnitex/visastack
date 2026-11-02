import type { Metadata } from 'next';
import { cookies, headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { agencyBrand } from '../../lib/agency-brand';
import { AgencyBrandScope, AgencyMark } from '../app/agency/[orgId]/org-branding-header';
import { COLLECT_COOKIE, collectSwitchOn, loadCollectPage, parseCookie } from './load';

export const metadata: Metadata = {
  title: 'Document Request',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};
export const dynamic = 'force-dynamic';

/**
 * The page an agency's request link opens (UMPE P6). It shows who is asking, and only for an agency
 * VisaStack has reviewed; never the person, the route, the checklist or whether anyone has an
 * account. Responding opens in a later release, and the page says so plainly.
 */
export default async function CollectPage({
  searchParams,
}: {
  readonly searchParams?: Promise<{ readonly busy?: string | string[] }>;
}) {
  if (!collectSwitchOn()) notFound();
  const busy = (await searchParams)?.busy === '1';
  const held = parseCookie((await cookies()).get(COLLECT_COOKIE)?.value);
  const page = busy
    ? ({ state: 'busy' } as const)
    : held
      ? await loadCollectPage(await headers(), held.token, held.linkId)
      : ({ state: 'closed' } as const);
  const agency = page.state === 'open' ? page.view.agency : null;
  const brand = agency
    ? agencyBrand({ name: agency.name, accentColor: agency.accentColor, logoUrl: null })
    : null;

  return (
    <section className="section container collect-page">
      {page.state === 'open' ? (
        <article className="card collect-card">
          <div className="card-body">
            {brand ? (
              <AgencyBrandScope brand={brand} className="collect-agency">
                <AgencyMark brand={brand} size="lg" />
                <h1 className="page-title">{brand.name} Asked You for Documents</h1>
              </AgencyBrandScope>
            ) : (
              <h1 className="page-title">An Agency Asked You for Documents</h1>
            )}
            <p>
              This private link comes from an agency that asked you, through VisaStack, for
              documents. Opening it has shared nothing.
            </p>
            <p>
              Responding through this link opens in a later release. Until then, ask the agency how
              they would like to receive your documents.
            </p>
            <p className="muted u-fs-085">
              If you were not expecting this, you can ignore it. Powered by VisaStack.
            </p>
          </div>
        </article>
      ) : page.state === 'busy' ? (
        <article className="card collect-card">
          <div className="card-body">
            <h1 className="page-title">Please Try Again Later</h1>
            <p>Too many links were opened from this network just now. Try again in an hour.</p>
          </div>
        </article>
      ) : (
        <article className="card collect-card">
          <div className="card-body">
            <h1 className="page-title">This Link Is Not Open</h1>
            <p>
              The link may have expired or been replaced, or the request may have ended. If it
              reached you recently, open it again from the message you received. Otherwise ask the
              agency that sent it for a new link.
            </p>
          </div>
        </article>
      )}
    </section>
  );
}
