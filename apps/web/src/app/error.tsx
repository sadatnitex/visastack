'use client';

import { errorPageText, fill } from '@visastack/i18n/client';
import Link from 'next/link';
import { useEffect } from 'react';
import { useLocale } from '../components/locale-provider';

/**
 * Route-level error boundary. Next.js renders this instead of the bare
 * "Application error" white screen when a Server Component throws during
 * render. It shows the digest so a failing request can be correlated with the
 * server logs, and offers a retry (which re-runs the failed render) plus a way
 * back out. The real cause is logged server-side in `withSession`. It speaks the
 * visitor's language (the root layout tells it which) and carries only its own
 * few messages, never a whole catalog.
 */
export default function AppError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  const locale = useLocale();
  const text = errorPageText(locale);

  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <section className="section container center">
      <span className="eyebrow">{text['error.generic.title']}</span>
      <h1 className="section-title" style={{ margin: '0.5rem 0 0' }}>
        {text['shell.error.heading']}
      </h1>
      <p className="section-sub" style={{ margin: '0.75rem auto 1.5rem', maxWidth: '34rem' }}>
        {text['shell.error.body']}
      </p>
      <div className="cta-row" style={{ justifyContent: 'center' }}>
        <button type="button" className="btn btn-primary" onClick={() => reset()}>
          {text['shell.error.retry']}
        </button>
        <Link className="btn btn-secondary" href="/">
          {text['shell.error.home']}
        </Link>
      </div>
      {error.digest ? (
        <p className="muted" style={{ marginTop: '1.5rem', fontSize: '0.8rem' }}>
          {fill(text['shell.error.reference'], { digest: error.digest }, locale)}
        </p>
      ) : null}
    </section>
  );
}
