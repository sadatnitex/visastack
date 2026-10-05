'use client';

import { errorPageText, fill } from '@visastack/i18n/client';
import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown in the root layout itself (where the
 * normal `error.tsx` cannot help because it renders *inside* the layout). It
 * must ship its own <html>/<body>. Kept deliberately dependency-free so it can
 * render even when app chrome or styles are the thing that failed. It cannot know
 * the visitor's language (the layout that would have told it is what failed), so
 * it says the same thing in English and in Bangla.
 */
export default function GlobalError({
  error,
  reset,
}: {
  readonly error: Error & { digest?: string };
  readonly reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const en = errorPageText('en');
  const bn = errorPageText('bn');

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: 'system-ui, -apple-system, sans-serif',
          display: 'flex',
          minHeight: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          margin: 0,
          padding: '2rem',
          textAlign: 'center',
          color: '#1d1d1f',
          background: '#fbfbfd',
        }}
      >
        <div style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>
            <span lang="en">{en['error.generic.title']}</span>
            {' / '}
            <span lang="bn">{bn['error.generic.title']}</span>
          </h1>
          <p style={{ color: '#6e6e73', marginBottom: '0.5rem' }} lang="en">
            {en['error.global.body']}
          </p>
          <p style={{ color: '#6e6e73', marginBottom: '1.5rem' }} lang="bn">
            {bn['error.global.body']}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '0.6rem 1.4rem',
              borderRadius: '980px',
              border: 'none',
              background: '#0071e3',
              color: '#fff',
              fontSize: '0.95rem',
              cursor: 'pointer',
            }}
          >
            <span lang="en">{en['shell.error.retry']}</span>
            {' / '}
            <span lang="bn">{bn['shell.error.retry']}</span>
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: '0.8rem', color: '#86868b' }}>
              <span lang="en">{fill(en['shell.error.reference'], { digest: error.digest })}</span>
              {' / '}
              <span lang="bn">{fill(bn['shell.error.reference'], { digest: error.digest })}</span>
            </p>
          ) : null}
        </div>
      </body>
    </html>
  );
}
