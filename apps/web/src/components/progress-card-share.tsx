'use client';

import { useEffect, useState } from 'react';

/**
 * Share Progress Card (WP-PIC15, owner decision D5 of 17 Nov 2026). The picture is made on the
 * server for the record's owner (counts only) at `/api/progress-card/<case>`.
 *
 * Where the phone can share a picture through its own share sheet, one button does that. Anywhere
 * else a plain Download link saves the same picture. Nothing shows until the browser has said
 * which it can do, so no control is ever offered that cannot work. The page shows this only while
 * the owner's PROGRESS_CARD switch is on.
 */

export const SHARE_PROGRESS_CARD = 'Share Progress Card';
export const DOWNLOAD_PROGRESS_CARD = 'Download Progress Card';
export const PROGRESS_CARD_BUSY = 'Making Your Card';
/** A second tap shares the card already made, when the phone wants a fresh tap to open its sheet. */
export const SHARE_PROGRESS_CARD_NOW = 'Share Your Card Now';
export const PROGRESS_CARD_FAILED = 'The card could not be made just now. Try again in a moment.';
const FILE_NAME = 'progress-card.png';

export function progressCardHref(missionId: string): string {
  return `/api/progress-card/${encodeURIComponent(missionId)}`;
}

type Mode = 'unknown' | 'share' | 'download';

/** True when this browser can hand a PNG file to the phone's share sheet. */
export function canShareImageFiles(nav: Navigator | undefined): boolean {
  if (!nav || typeof nav.share !== 'function' || typeof nav.canShare !== 'function') return false;
  try {
    const probe = new File([new Uint8Array([0x89])], FILE_NAME, { type: 'image/png' });
    return nav.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

/** The card as a file, or null when the answer is not a PNG (signed out, switched off, not found). */
async function fetchCard(href: string): Promise<File | null> {
  const response = await fetch(href, {
    credentials: 'same-origin',
    cache: 'no-store',
    // A sign-in redirect would end on an HTML page: never share that as a picture.
    redirect: 'error',
  });
  if (!response.ok || response.headers.get('content-type') !== 'image/png') return null;
  return new File([await response.blob()], FILE_NAME, { type: 'image/png' });
}

export function ProgressCardShare({ missionId }: { readonly missionId: string }) {
  const [mode, setMode] = useState<Mode>('unknown');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A card made but not yet shared: some phones (Safari) only open the share sheet straight after
  // a tap, and making the card takes a moment, so the next tap shares it at once.
  const [ready, setReady] = useState<File | null>(null);
  const href = progressCardHref(missionId);

  useEffect(() => {
    setMode(
      canShareImageFiles(typeof navigator === 'undefined' ? undefined : navigator)
        ? 'share'
        : 'download',
    );
  }, []);

  async function share() {
    if (busy) return;
    setFailed(false);
    let file = ready;
    if (!file) {
      setBusy(true);
      try {
        file = await fetchCard(href);
      } catch {
        file = null;
      } finally {
        setBusy(false);
      }
      if (!file) {
        setFailed(true);
        return;
      }
    }
    try {
      await navigator.share({ files: [file], title: 'Progress Card' });
      setReady(null);
    } catch (error) {
      const name = error instanceof DOMException ? error.name : '';
      // Closing the share sheet is a choice, not a failure.
      if (name === 'AbortError') setReady(null);
      // The phone wants a fresh tap: keep the card so the next tap shares it straight away.
      else if (name === 'NotAllowedError') setReady(file);
      else {
        setReady(null);
        setFailed(true);
      }
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
        <a className="btn btn-primary" href={href} download={FILE_NAME}>
          {DOWNLOAD_PROGRESS_CARD}
        </a>
      )}
      <output className="progress-card-share-status" aria-live="polite">
        {failed ? PROGRESS_CARD_FAILED : ''}
      </output>
    </div>
  );
}
