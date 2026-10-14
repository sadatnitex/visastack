'use client';

import { useEffect } from 'react';

/**
 * Last-resort boundary for errors thrown in the root layout itself (where the
 * normal `error.tsx` cannot help because it renders *inside* the layout). It
 * must ship its own <html>/<body>. Kept deliberately dependency-free so it can
 * render even when app chrome or styles are the thing that failed.
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
        <main style={{ maxWidth: '32rem' }}>
          <h1 style={{ fontSize: '1.5rem', marginBottom: '0.75rem' }}>Something went wrong</h1>
          <p style={{ color: '#6e6e73', marginBottom: '1.5rem' }}>
            An unexpected error interrupted the page. Please try again.
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
              fontSize: 'var(--text-body)',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          {error.digest ? (
            <p style={{ marginTop: '1.5rem', fontSize: 'var(--text-small)', color: '#86868b' }}>
              Reference: {error.digest}
            </p>
          ) : null}
        </main>
      </body>
    </html>
  );
}
