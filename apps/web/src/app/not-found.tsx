import Link from 'next/link';
import { publicMessage } from '../components/public-site/public-text';
import { MISC_MESSAGES as X } from '../i18n/misc-messages';
import { getPageLanguage, primeLocale } from '../lib/i18n-server';
import { localizedMetadata } from '../lib/localized-metadata';

/** The browser tab and history name this page (WCAG 2.4.2); the layout adds the product name. */
export const generateMetadata = localizedMetadata({ title: 'Page Not Found' });

/**
 * Global 404. Without this, Next.js falls back to its bare, unstyled default
 * page for any bad or stale link (an old bookmark to a deleted applicant, a
 * revoked share link, a typo) — off-brand and a dead end. This mirrors
 * `error.tsx`'s recoverable-error framing but for "not found" rather than
 * "something broke," with a real way back into the app.
 */
export default async function NotFound() {
  const locale = await primeLocale();
  const lang = getPageLanguage();
  const pm = (message: Parameters<typeof publicMessage>[0]) => publicMessage(message, lang, locale);
  return (
    <section className="section container center">
      <span className="eyebrow">{pm(X['misc.notFound.eyebrow'])}</span>
      <h1 className="section-title" style={{ margin: '0.5rem 0 0' }}>
        {pm(X['misc.notFound.heading'])}
      </h1>
      <p className="section-sub" style={{ margin: '0.75rem auto 1.5rem', maxWidth: '34rem' }}>
        {pm(X['misc.notFound.body'])}
      </p>
      <div className="cta-row" style={{ justifyContent: 'center' }}>
        {/* A plain anchor, like the landing page and the nav: `/app` answers a
            signed-out visitor with a redirect to sign-in, and a `<Link>` would
            prefetch it with a script request that the redirect breaks.
            Crossing into the signed-in area is a full navigation. */}
        <a className="btn btn-primary" href="/app">
          {pm(X['misc.goWorkspace'])}
        </a>
        <Link className="btn btn-secondary" href="/">
          {pm(X['misc.backHome'])}
        </Link>
      </div>
    </section>
  );
}
