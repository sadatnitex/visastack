'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import { useT } from '../components/i18n-provider';
import { homeCatalog } from '../i18n/home';

/**
 * Route-level error boundary. Next.js renders this instead of the bare
 * "Application error" white screen when a Server Component throws during
 * render. It shows the digest so a failing request can be correlated with the
 * server logs, and offers a retry (which re-runs the failed render) plus a way
 * back out. The real cause is logged server-side in `withSession`.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const t = useT(homeCatalog);
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="section container center">
      <span className="eyebrow">{t.node('home.error.somethingWentWrong')}</span>
      <h1 className="section-title error-title">{t.node('home.error.weHitASnagLoadingThis')}</h1>
      <p className="section-sub error-body">{t.node('home.error.thisIsOnOurSideNot')}</p>
      <div className="cta-row cta-row-center">
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          {t.node('home.error.tryAgain')}
        </button>
        <Link className="btn btn-secondary" href="/">
          {t.node('home.error.backToHome')}
        </Link>
      </div>
      {error.digest ? (
        <p className="muted error-reference">
          {t.node('home.error.referenceDigest', { digest: error.digest })}
        </p>
      ) : null}
    </section>
  );
}
