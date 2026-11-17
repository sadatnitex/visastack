'use client';

import { useEffect, useRef } from 'react';
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
 * Placed inside a sign-out form: when that form is sent, the shared files waiting on this phone
 * are emptied too, so the next person to use it never sees them. The sign-out itself is untouched:
 * it only listens, never delays or stops the form, and the form works the same before the page has
 * loaded its scripts. It renders one hidden field with no name, so nothing is added to the form.
 */
export function ClearShareInboxOnSubmit() {
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const form = field.current?.form;
    if (!form) return;
    form.addEventListener('submit', postClearShareInbox);
    return () => form.removeEventListener('submit', postClearShareInbox);
  }, []);
  return <input ref={field} type="hidden" />;
}
