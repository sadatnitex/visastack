'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { startRefreshLoop } from '../lib/resilience';

/**
 * Keeps a page up to date while the server is still working on something (a document
 * being scanned and read), so nobody has to reload to see it finish and nobody is
 * tempted to upload the file again because nothing seemed to happen (directive Part 9
 * section 3: a job still processing; a resilient progress state).
 *
 * While `active` it asks Next to re-run the page's own data fetch on the schedule in
 * `lib/resilience.ts` (quickly at first, then slowly, for about ten minutes), does
 * nothing while the tab is hidden, and catches up when the tab is shown again.
 * `router.refresh()` keeps what a person has typed in the page's forms. When the
 * server's answer no longer needs watching the page renders `active={false}` and this
 * stops.
 */
export function AutoRefresh({ active }: { readonly active: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!active) return;
    const loop = startRefreshLoop({
      refresh: () => router.refresh(),
      isHidden: () => document.hidden,
      setTimer: (run, ms) => setTimeout(run, ms),
      clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    });
    document.addEventListener('visibilitychange', loop.onVisible);
    return () => {
      loop.stop();
      document.removeEventListener('visibilitychange', loop.onVisible);
    };
  }, [active, router]);

  return null;
}
