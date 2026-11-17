'use client';

import type { ReactNode } from 'react';
import { SHARE_CLEAR_MESSAGE } from './share-target';

/**
 * Tells this phone's service worker to drop any files shared from another app that are still
 * waiting (WP-PIC11). Fire and forget: it never waits for an answer, never throws, and does
 * nothing when no worker controls the page or sharing is off. The worker accepts it only from a
 * VisaStack page.
 */
export function postClearShareInbox(): void {
  try {
    navigator.serviceWorker?.controller?.postMessage({ type: SHARE_CLEAR_MESSAGE });
  } catch {
    // Nothing to clear, or no worker: the 15-minute limit still applies.
  }
}

/**
 * A sign-out form that also empties the shared files waiting on this phone, so the next person to
 * use it never sees them. The sign-out itself is untouched: the server action runs exactly as
 * before (nothing is delayed or prevented), and the form works the same before the page has loaded
 * its scripts.
 */
export function ClearShareInboxOnSubmit({
  action,
  className,
  children,
}: {
  readonly action: (formData: FormData) => void | Promise<void>;
  readonly className?: string;
  readonly children: ReactNode;
}) {
  return (
    <form action={action} className={className} onSubmit={postClearShareInbox}>
      {children}
    </form>
  );
}
