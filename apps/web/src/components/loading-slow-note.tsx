'use client';

import { useEffect, useState } from 'react';

/** How long a screen may load before it says so. Short enough for weak phone data. */
export const LOADING_SLOW_AFTER_MS = 8000;

/**
 * Appears only if a loading screen is still showing after a few seconds, so nobody on a weak
 * connection is left guessing. It renders nothing at first, so the loading screen itself is
 * identical on the server and in the first paint.
 */
export function LoadingSlowNote({
  afterMs = LOADING_SLOW_AFTER_MS,
}: { readonly afterMs?: number }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);
  return slow ? (
    <span className="muted loading-note">Still loading. You can keep this page open.</span>
  ) : null;
}
