'use client';

import { useEffect, useState } from 'react';
import { PROGRESS_CARD_FILE_NAME } from '../lib/progress-card/file-name';

/**
 * Share Progress Card (WP-PIC15, owner decision D5 of 17 Nov 2026). The picture is made on the
 * server for the record's owner (counts only) at `/api/progress-card/<case>`.
 *
 * Where the phone can share a picture through its own share sheet, one button does that. Anywhere
 * else a Download button saves the same picture. Both fetch the card first and check it really is
 * a picture, so a sign-in page or a not-found page is never saved or shared; when that check fails
 * a plain message says so. Nothing shows until the browser has said which it can do, so no control
 * is ever offered that cannot work. The page shows this only while the owner's PROGRESS_CARD switch
 * is on.
 */

export const SHARE_PROGRESS_CARD = 'Share Progress Card';
export const DOWNLOAD_PROGRESS_CARD = 'Download Progress Card';
export const PROGRESS_CARD_BUSY = 'Making Your Card';
/** A second tap shares the card already made, when the phone wants a fresh tap to open its sheet. */
export const SHARE_PROGRESS_CARD_NOW = 'Share Your Card Now';
export const PROGRESS_CARD_MAKING = 'Making your card. This takes a moment.';
export const PROGRESS_CARD_TAP_AGAIN = 'Your card is ready. Tap Share Your Card Now to share it.';
export const PROGRESS_CARD_FAILED = 'The card could not be made just now. Try again in a moment.';
export const PROGRESS_CARD_SAVED = 'Your card was saved.';
/** How long a saved card's temporary address is kept before it is let go. */
const RELEASE_AFTER_MS = 1000;
/** A card that has not arrived by then is treated as not made, so the button never stays locked. */
const CARD_WAIT_MS = 20_000;

export function progressCardHref(missionId: string): string {
  return `/api/progress-card/${encodeURIComponent(missionId)}`;
}

type Mode = 'unknown' | 'share' | 'download';
type Status = 'idle' | 'making' | 'tap-again' | 'saved' | 'failed';

const STATUS_TEXT: Readonly<Record<Status, string>> = {
  idle: '',
  making: PROGRESS_CARD_MAKING,
  'tap-again': PROGRESS_CARD_TAP_AGAIN,
  saved: PROGRESS_CARD_SAVED,
  failed: PROGRESS_CARD_FAILED,
};

/** True when this browser can hand a PNG file to the phone's share sheet. */
export function canShareImageFiles(nav: Navigator | undefined): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array([0x89])], PROGRESS_CARD_FILE_NAME, {
      type: 'image/png',
    });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** The card as a file, or null when the answer is not a PNG (signed out, switched off, not found). */
async function fetchCard(href: string): Promise<File | null> {
  try {
    const response = await fetch(href, {
      credentials: 'same-origin',
      cache: 'no-store',
      // A sign-in redirect would end on an HTML page: never save or share that as a picture.
      redirect: 'error',
      signal: AbortSignal.timeout(CARD_WAIT_MS),
    });
    if (response.status !== 200 || response.headers.get('content-type') !== 'image/png') {
      return null;
    }
    return new File([await response.blob()], PROGRESS_CARD_FILE_NAME, { type: 'image/png' });
  } catch {
    return null;
  }
}

/** Saves the file through a short-lived link, then lets its temporary address go. */
function saveFile(file: File): void {
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  link.rel = 'noopener';
  link.hidden = true;
  document.body.append(link);
  try {
    link.click();
  } finally {
    link.remove();
    // Some browsers start the save a moment after the click, so the address is kept briefly.
    setTimeout(() => URL.revokeObjectURL(url), RELEASE_AFTER_MS);
  }
}

export function ProgressCardShare({ missionId }: { readonly missionId: string }) {
  const [mode, setMode] = useState<Mode>('unknown');
  const [status, setStatus] = useState<Status>('idle');
  // A card made but not yet shared: some phones (Safari) only open the share sheet straight after
  // a tap, and making the card takes a moment, so the next tap shares it at once.
  const [ready, setReady] = useState<File | null>(null);
  const busy = status === 'making';
  const href = progressCardHref(missionId);

  // A card kept for a second tap belongs to one case: when the page moves to another case, drop
  // it and any message during this render, so it can never be shared for the wrong case.
  const [shownFor, setShownFor] = useState(href);
  if (shownFor !== href) {
    setShownFor(href);
    setReady(null);
    setStatus('idle');
  }

  useEffect(() => {
    setMode(
      canShareImageFiles(typeof navigator === 'undefined' ? undefined : navigator)
        ? 'share'
        : 'download',
    );
  }, []);

  /** The card already kept for a second tap, or a fresh one; null (with a message) on failure. */
  async function card(): Promise<File | null> {
    if (ready) return ready;
    setStatus('making');
    const file = await fetchCard(href);
    setStatus(file ? 'idle' : 'failed');
    return file;
  }

  async function share() {
    if (busy) return;
    const file = await card();
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: 'Progress Card' });
      setReady(null);
      setStatus('idle');
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      if (name === 'AbortError') {
        // Closing the share sheet is a choice, not a failure.
        setReady(null);
        setStatus('idle');
      } else if (name === 'NotAllowedError') {
        // The phone wants a fresh tap: keep the card so the next tap shares it straight away.
        setReady(file);
        setStatus('tap-again');
      } else {
        setReady(null);
        setStatus('failed');
      }
    }
  }

  async function download() {
    if (busy) return;
    const file = await card();
    if (!file) return;
    try {
      saveFile(file);
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  }

  if (mode === 'unknown') return null;
  return (
    <div className="progress-card-share">
      {mode === 'share' ? (
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          onClick={share}
        >
          {busy ? PROGRESS_CARD_BUSY : ready ? SHARE_PROGRESS_CARD_NOW : SHARE_PROGRESS_CARD}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-primary"
          aria-disabled={busy || undefined}
          onClick={download}
        >
          {busy ? PROGRESS_CARD_BUSY : DOWNLOAD_PROGRESS_CARD}
        </button>
      )}
      <output className="progress-card-share-status" aria-live="polite">
        {STATUS_TEXT[status]}
      </output>
    </div>
  );
}
